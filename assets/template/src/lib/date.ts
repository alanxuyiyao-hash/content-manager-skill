import { format, parseISO, isValid } from 'date-fns'

// 全程用 'YYYY-MM-DD' 字符串当日期键，避免时区问题
export const toKey = (d: Date): string => format(d, 'yyyy-MM-dd')
export const todayKey = (): string => toKey(new Date())
export const fromKey = (s: string): Date => parseISO(s)

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = parseISO(value)
  return isValid(parsed) && toKey(parsed) === value
}

export function prettyDate(key?: string): string {
  if (!key) return ''
  const d = fromKey(key)
  // 非法日期串（手改/跨版本导入）不再让 format 抛 RangeError 整页白屏
  return isValid(d) ? format(d, 'MMM d') : ''
}

// HH:MM 平移 minutes 分钟，夹紧在 00:00–23:59
export function shiftHHMM(t: string, minutes: number): string {
  const [h, m] = t.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, Math.max(0, (h || 0) * 60 + (m || 0) + minutes))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
