import { describe, expect, it } from 'vitest'
import { runBackupExportOnce } from './backupExportLock'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('runBackupExportOnce', () => {
  it('starts only one export while the first export is still running', async () => {
    const lock = { current: false }
    const firstExport = deferred()
    let starts = 0

    const first = runBackupExportOnce(lock, async () => {
      starts += 1
      await firstExport.promise
    })
    const second = await runBackupExportOnce(lock, async () => {
      starts += 1
    })

    expect(second).toBe(false)
    expect(starts).toBe(1)
    firstExport.resolve()
    await expect(first).resolves.toBe(true)
    expect(lock.current).toBe(false)
  })

  it('releases the lock after a failed export so a later export can retry', async () => {
    const lock = { current: false }
    let starts = 0

    await expect(
      runBackupExportOnce(lock, async () => {
        starts += 1
        throw new Error('share unavailable')
      }),
    ).rejects.toThrow('share unavailable')

    await expect(
      runBackupExportOnce(lock, async () => {
        starts += 1
      }),
    ).resolves.toBe(true)
    expect(starts).toBe(2)
    expect(lock.current).toBe(false)
  })
})
