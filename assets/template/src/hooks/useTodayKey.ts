import { useEffect, useState } from 'react'
import { todayKey } from '../lib/date'

/**
 * 返回当前日期键 'YYYY-MM-DD'，并在「回到前台 / 窗口聚焦 / 跨过午夜」时自动刷新，
 * 触发使用它的组件重渲染。解决 PWA 停在某页过夜后「今天」高亮、逾期判定、每日提醒仍停在昨天的问题。
 */
export function useTodayKey(): string {
  const [key, setKey] = useState(todayKey)
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden') return
      const k = todayKey()
      setKey((prev) => (prev !== k ? k : prev))
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    // 兜底：一直停在前台跨午夜时 visibilitychange/focus 不会触发，每分钟自查一次
    const timer = window.setInterval(check, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      clearInterval(timer)
    }
  }, [])
  return key
}
