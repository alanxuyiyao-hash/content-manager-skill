import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  setMonth,
  setYear,
  isSameMonth,
  isSameDay,
} from 'date-fns'
import { toKey, fromKey } from '../lib/date'
import { haptic } from '../lib/haptics'
import { XIcon } from './AppHeader'
import { ChevronLeft, ChevronRight, ChevronDown } from './AppHeader'
import { useAndroidBackHandler } from '../hooks/useAndroidBackHandler'

const WEEK = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * 复刻 Basecamp「Choose a date」底部日历：月/年下拉 + 翻月 + 周表头 + 今日高亮。
 * 日期统一用 'YYYY-MM-DD' 键（与全局 toKey/fromKey 一致，规避时区）。
 */
export default function DatePicker({
  value,
  onPick,
  onClear,
  onClose,
}: {
  value?: string
  onPick: (key: string) => void
  onClear?: () => void
  onClose: () => void
}) {
  const today = new Date()
  const dpRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dpRef) // 与 Sheet 一致：打开移入焦点、Tab 内循环、关闭还焦点（ix-7）
  useAndroidBackHandler(() => {
    onClose()
    return true
  })
  const [cursor, setCursor] = useState<Date>(() => (value ? fromKey(value) : new Date()))
  const selected = value ? fromKey(value) : null

  const gs = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
  const ge = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
  const days: Date[] = []
  for (let d = gs; d <= ge; d = addDays(d, 1)) days.push(d)

  const years: number[] = []
  for (let i = -3; i <= 6; i++) years.push(today.getFullYear() + i)
  // 编辑更早/更晚年份的旧记录时，把光标年并入选项，避免年份下拉落不到值显示空白
  if (!years.includes(cursor.getFullYear())) {
    years.push(cursor.getFullYear())
    years.sort((a, b) => a - b)
  }

  // 快捷芯片：今天 / 明天 / 本周末（最近的周六）/ 下周一
  const dow = today.getDay() // 0=Sun .. 6=Sat
  const toSat = (6 - dow + 7) % 7
  const toNextMon = ((8 - dow) % 7) || 7
  const quick = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: addDays(today, toSat) },
    { label: 'Next week', date: addDays(today, toNextMon) },
  ]

  return (
    <div className="sheet-layer dp-layer el-sheet" onClick={onClose}>
      <div className="sheet-backdrop" />
      <div
        className="dp"
        ref={dpRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a date"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dp-head">
          <span className="dp-title">Choose a date</span>
          <button className="dp-x" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="dp-quick">
          {quick.map((q) => {
            const key = toKey(q.date)
            return (
              <button
                key={q.label}
                type="button"
                className={'td-chip' + (value === key ? ' on' : '')}
                onClick={() => {
                  haptic(8)
                  onPick(key)
                  onClose()
                }}
              >
                {q.label}
              </button>
            )
          })}
        </div>

        <div className="dp-ctrl">
          <div className="dp-my">
            <span className="dp-sel">
              <select
                value={cursor.getMonth()}
                aria-label="Month"
                onChange={(e) => setCursor((c) => setMonth(c, Number(e.target.value)))}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </span>
            <span className="dp-sel">
              <select
                value={cursor.getFullYear()}
                aria-label="Year"
                onChange={(e) => setCursor((c) => setYear(c, Number(e.target.value)))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </span>
          </div>
          <div className="dp-nav">
            <button aria-label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))}>
              <ChevronLeft />
            </button>
            <button aria-label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))}>
              <ChevronRight />
            </button>
          </div>
        </div>

        <div className="dp-dow">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="dp-grid">
          {days.map((d) => {
            const out = !isSameMonth(d, cursor)
            const isToday = isSameDay(d, today)
            const isSel = selected && isSameDay(d, selected)
            return (
              <button
                key={toKey(d)}
                type="button"
                className={'dp-cell' + (out ? ' out' : '') + (isToday ? ' today' : '') + (isSel ? ' sel' : '')}
                onClick={() => {
                  haptic(8)
                  onPick(toKey(d))
                  onClose()
                }}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>

        {onClear && (
          <button
            className="dp-clear"
            onClick={() => {
              haptic(8)
              onClear()
              onClose()
            }}
          >
            Clear date
          </button>
        )}
      </div>
    </div>
  )
}
