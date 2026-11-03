export type AndroidBackHandler = () => boolean | Promise<boolean>

type RegisteredHandler = {
  active: boolean
  handler: AndroidBackHandler
}

export function createBackDispatcher() {
  const handlers: RegisteredHandler[] = []
  let dispatchTail: Promise<void> = Promise.resolve()

  return {
    register(handler: AndroidBackHandler) {
      const entry: RegisteredHandler = { active: true, handler }
      handlers.push(entry)

      return () => {
        if (!entry.active) return
        entry.active = false
        const index = handlers.indexOf(entry)
        if (index >= 0) handlers.splice(index, 1)
      }
    },

    dispatch(): Promise<boolean> {
      const run = dispatchTail.then(async () => {
        const snapshot = [...handlers]
        for (let index = snapshot.length - 1; index >= 0; index -= 1) {
          const entry = snapshot[index]
          if (entry.active && await entry.handler()) return true
        }
        return false
      })
      dispatchTail = run.then(() => undefined, () => undefined)
      return run
    },
  }
}

export const androidBackDispatcher = createBackDispatcher()

export async function exitWhenUnhandled(
  dispatch: () => Promise<boolean>,
  exit: () => Promise<void>,
): Promise<void> {
  if (!(await dispatch())) await exit()
}

export function createNonThrowingErrorSink(reportError: (error: unknown) => void) {
  return (error: unknown): void => {
    try {
      reportError(error)
    } catch {
      // Error reporting is the final rejection boundary and must not leak another error.
    }
  }
}

export function handleNativeBack(
  dispatch: () => Promise<boolean>,
  exit: () => Promise<void>,
  reportError: (error: unknown) => void,
): void {
  void exitWhenUnhandled(dispatch, exit).catch(createNonThrowingErrorSink(reportError))
}
