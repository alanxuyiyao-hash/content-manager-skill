import { describe, it, expect } from 'vitest'
import { toKey, isDateKey, prettyDate, shiftHHMM } from './date'

describe('toKey', () => {
  it('格式化为 YYYY-MM-DD', () => {
    // 用本地时间构造，避开时区：2026-07-03
    expect(toKey(new Date(2026, 6, 3))).toBe('2026-07-03')
  })
})

describe('isDateKey', () => {
  it('只接受真实存在的 YYYY-MM-DD 日期键', () => {
    expect(isDateKey('2026-07-03')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('2026-7-3')).toBe(false)
    expect(isDateKey('2026-07-03T12:00:00Z')).toBe(false)
  })
})

describe('prettyDate — 非法日期不白屏', () => {
  it('空值返回空串', () => {
    expect(prettyDate(undefined)).toBe('')
    expect(prettyDate('')).toBe('')
  })
  it('非法日期串返回空串（不抛 RangeError）', () => {
    expect(prettyDate('not-a-date')).toBe('')
    expect(prettyDate('2026-13-99')).toBe('')
  })
  it('合法日期格式化为 MMM d', () => {
    expect(prettyDate('2026-07-03')).toBe('Jul 3')
  })
})

describe('shiftHHMM — 平移并夹紧 00:00–23:59', () => {
  it('正常平移', () => {
    expect(shiftHHMM('09:30', 45)).toBe('10:15')
    expect(shiftHHMM('10:00', -30)).toBe('09:30')
  })
  it('下溢夹到 00:00', () => {
    expect(shiftHHMM('00:10', -30)).toBe('00:00')
  })
  it('上溢夹到 23:59', () => {
    expect(shiftHHMM('23:50', 30)).toBe('23:59')
  })
  it('补零', () => {
    expect(shiftHHMM('08:05', 0)).toBe('08:05')
  })
})
