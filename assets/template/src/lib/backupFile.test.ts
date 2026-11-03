import { describe, expect, it } from 'vitest'
import { saveBackupJSON, type BackupFilePorts } from './backupFile'

function ports(native: boolean) {
  const calls: string[] = []
  const value: BackupFilePorts = {
    isNative: native,
    downloadWeb: (_text, filename) => calls.push(`download:${filename}`),
    writeNative: async (_text, filename) => {
      calls.push(`write:${filename}`)
      return 'file:///cache/backup.json'
    },
    shareNative: async (uri) => {
      calls.push(`share:${uri}`)
    },
  }
  return { calls, value }
}

describe('saveBackupJSON', () => {
  it('downloads in a browser without touching native storage', async () => {
    const p = ports(false)
    const result = await saveBackupJSON({ projects: [] }, 'backup.json', p.value)
    expect(result).toBe('downloaded')
    expect(p.calls).toEqual(['download:backup.json'])
  })

  it('writes then shares a private cache file in the native shell', async () => {
    const p = ports(true)
    const result = await saveBackupJSON({ projects: [] }, 'backup.json', p.value)
    expect(result).toBe('shared')
    expect(p.calls).toEqual(['write:backup.json', 'share:file:///cache/backup.json'])
  })

  it('reports a native share failure instead of claiming export succeeded', async () => {
    const p = ports(true)
    p.value.shareNative = async () => {
      throw new Error('share unavailable')
    }
    await expect(saveBackupJSON({ projects: [] }, 'backup.json', p.value)).rejects.toThrow(
      'share unavailable',
    )
  })

  it('treats closing the native share sheet as a canceled export', async () => {
    const p = ports(true)
    p.value.shareNative = async () => {
      throw new Error('Share canceled')
    }

    await expect(saveBackupJSON({ projects: [] }, 'backup.json', p.value)).resolves.toBe(
      'canceled',
    )
  })
})
