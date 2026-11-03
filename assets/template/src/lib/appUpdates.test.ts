import { describe, expect, it } from 'vitest'
import { startAppUpdates, type UpdateRegistrar } from './appUpdates'

describe('startAppUpdates', () => {
  it('does not register a service worker in the native shell', () => {
    let registrations = 0
    const register: UpdateRegistrar = () => {
      registrations += 1
      return () => undefined
    }

    startAppUpdates({ isNative: true, register, notify: () => undefined })

    expect(registrations).toBe(0)
  })

  it('offers the existing reload action when the web service worker reports an update', () => {
    let onNeedRefresh: (() => void) | undefined
    let reloaded = false
    let action: (() => void) | undefined
    const register: UpdateRegistrar = (options) => {
      onNeedRefresh = options.onNeedRefresh
      return () => {
        reloaded = true
      }
    }

    startAppUpdates({
      isNative: false,
      register,
      notify: (_message, options) => {
        action = options.onAction
      },
    })
    onNeedRefresh?.()
    action?.()

    expect(reloaded).toBe(true)
  })
})
