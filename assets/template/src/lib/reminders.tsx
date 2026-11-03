import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// 逾期提醒开关（纯本机偏好，仿 privacy.tsx）。
// 平台真相：PWA 无法在 App 关闭时后台调度本地通知，所以这里只做「打开即提醒」——
// 每次打开 App 且有逾期单时，弹一条系统通知；App 关着时不承诺任何后台推送。
// 权限被拒/不支持时静默降级（首页仍有 Overdue 筛选 chip 作为可见入口）。
const KEY = 'cm-overdue-reminders'

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window

export const notificationPermission = (): NotificationPermission =>
  notificationsSupported() ? Notification.permission : 'denied'

type Ctx = { remindersOn: boolean; toggleReminders: () => void }
const RemindersCtx = createContext<Ctx>({ remindersOn: false, toggleReminders: () => {} })

export function RemindersProvider({ children }: { children: ReactNode }) {
  const [remindersOn, setOn] = useState<boolean>(read)
  const toggleReminders = useCallback(() => {
    setOn((v) => {
      const next = !v
      try {
        localStorage.setItem(KEY, next ? '1' : '0')
      } catch {
        /* 存储不可用：忽略 */
      }
      // 开启时请求通知权限；被拒或不支持则静默降级（横幅仍在）
      if (next && notificationsSupported() && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ remindersOn, toggleReminders }), [remindersOn, toggleReminders])
  return <RemindersCtx.Provider value={value}>{children}</RemindersCtx.Provider>
}

export const useReminders = (): Ctx => useContext(RemindersCtx)

// 本次会话仅弹一次，避免重渲染/切页重复打扰（模块级标记，刷新页面即重置＝下次打开再提醒）。
let firedThisSession = false

// 打开即提醒：有逾期单且开关开启且已授权时，弹一条系统通知。其余情况静默（诚实降级）。
export function maybeNotifyOverdue(on: boolean, count: number, topLabel: string): void {
  if (!on || count <= 0 || firedThisSession) return
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  firedThisSession = true
  try {
    new Notification(`${count} order${count === 1 ? '' : 's'} overdue`, {
      body: topLabel,
      tag: 'cm-overdue',
    })
  } catch {
    // 部分浏览器（尤其移动端）要求经 ServiceWorkerRegistration.showNotification 才能弹：静默降级
  }
}
