import { describe, expect, it, vi } from 'vitest'
import { createBackDispatcher, exitWhenUnhandled, handleNativeBack } from './androidBack'

describe('Android back dispatch', () => {
  it('runs the newest handler first and stops after it handles the event', async () => {
    const dispatcher = createBackDispatcher()
    const calls: string[] = []
    dispatcher.register(() => { calls.push('sheet'); return true })
    dispatcher.register(() => { calls.push('date-picker'); return true })

    expect(await dispatcher.dispatch()).toBe(true)
    expect(calls).toEqual(['date-picker'])
  })

  it('continues downward when a newer handler declines the event', async () => {
    const dispatcher = createBackDispatcher()
    const calls: string[] = []
    dispatcher.register(() => { calls.push('sheet'); return true })
    dispatcher.register(() => { calls.push('date-picker'); return false })

    expect(await dispatcher.dispatch()).toBe(true)
    expect(calls).toEqual(['date-picker', 'sheet'])
  })

  it('removes handlers without leaving ghost callbacks', async () => {
    const dispatcher = createBackDispatcher()
    const calls: string[] = []
    const remove = dispatcher.register(() => { calls.push('removed'); return true })
    remove()

    expect(await dispatcher.dispatch()).toBe(false)
    expect(calls).toEqual([])
  })

  it('removes only its own registration when the same handler is registered twice', async () => {
    const dispatcher = createBackDispatcher()
    const handler = vi.fn(() => true)
    const removeFirst = dispatcher.register(handler)
    dispatcher.register(handler)
    removeFirst()
    removeFirst()

    expect(await dispatcher.dispatch()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('skips a handler unregistered while an async handler is pending', async () => {
    const dispatcher = createBackDispatcher()
    const lower = vi.fn(() => true)
    const removeLower = dispatcher.register(lower)
    let resolveTop: ((handled: boolean) => void) | undefined
    dispatcher.register(() => new Promise<boolean>((resolve) => { resolveTop = resolve }))

    const pending = dispatcher.dispatch()
    await Promise.resolve()
    removeLower()
    resolveTop?.(false)

    expect(await pending).toBe(false)
    expect(lower).not.toHaveBeenCalled()
  })

  it('serializes concurrent dispatches so a handler is not re-entered', async () => {
    const dispatcher = createBackDispatcher()
    let active = 0
    let calls = 0
    let resolveFirst: (() => void) | undefined
    dispatcher.register(async () => {
      calls += 1
      active += 1
      expect(active).toBe(1)
      if (calls === 1) await new Promise<void>((resolve) => { resolveFirst = resolve })
      active -= 1
      return true
    })

    const first = dispatcher.dispatch()
    const second = dispatcher.dispatch()
    await Promise.resolve()
    expect(calls).toBe(1)
    resolveFirst?.()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(calls).toBe(2)
  })

  it('exits only when no registered layer handles back', async () => {
    let exits = 0
    await exitWhenUnhandled(async () => false, async () => { exits += 1 })
    await exitWhenUnhandled(async () => true, async () => { exits += 1 })
    expect(exits).toBe(1)
  })

  it('contains a rejected dispatch, reports it, and does not exit', async () => {
    const error = new Error('handler failed')
    const exit = vi.fn(async () => undefined)
    const reportError = vi.fn()

    expect(handleNativeBack(async () => { throw error }, exit, reportError)).toBeUndefined()
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(error))

    expect(exit).not.toHaveBeenCalled()
  })

  it('contains and reports an exit rejection', async () => {
    const error = new Error('exit failed')
    const reportError = vi.fn()

    handleNativeBack(async () => false, async () => { throw error }, reportError)
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(error))
  })

  it('contains a throwing error reporter without leaking an unhandled rejection', async () => {
    const originalError = new Error('handler failed')
    const reportError = vi.fn(() => { throw new Error('reporter failed') })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      handleNativeBack(async () => { throw originalError }, async () => undefined, reportError)
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(reportError).toHaveBeenCalledWith(originalError)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
