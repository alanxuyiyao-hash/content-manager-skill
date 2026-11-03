import { useEffect, useState } from 'react'

type ToastItem = { id: number; msg: string; actionLabel?: string; onAction?: () => void }
type ToastOpts = { actionLabel?: string; onAction?: () => void; duration?: number }

let listeners: ((items: ToastItem[]) => void)[] = []
let items: ToastItem[] = []
let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const l of listeners) l(items.slice())
}

function dismiss(id: number) {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  items = items.filter((it) => it.id !== id)
  emit()
}

/**
 * 模块级触发：import { toast } 后调用 toast('已保存')。
 * 带撤销：toast('Deleted', { actionLabel: 'Undo', onAction: () => restore() })。
 */
export function toast(msg: string, opts?: ToastOpts) {
  const id = ++seq
  items = [...items, { id, msg, actionLabel: opts?.actionLabel, onAction: opts?.onAction }]
  emit()
  // 撤销类停留更久（默认 5s），普通提示 2.2s
  const dur = opts?.duration ?? (opts?.onAction ? 5000 : 2200)
  timers.set(id, setTimeout(() => dismiss(id), dur))
}

/** 挂在 App 根部一次即可，自带淡入上移动画（见 styles.css .toast-*）。 */
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([])

  useEffect(() => {
    const l = (next: ToastItem[]) => setList(next)
    listeners.push(l)
    setList(items.slice())
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  }, [])

  if (list.length === 0) return null
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-msg">{t.msg}</span>
          {t.actionLabel && t.onAction && (
            <button
              className="toast-action"
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default ToastHost
