import { describe, it, expect } from 'vitest'
import type { Project } from '../types'
import {
  projectReleaseDay,
  projectMonthKey,
  isProjectOverdue,
  projectsInMonth,
  projectsInYear,
  projectsPublishingOn,
} from './projectSchedule'

const mk = (partial: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'X',
  status: 'lead',
  entries: [],
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...partial,
})

describe('projectReleaseDay — 发布日优先级', () => {
  it('releaseDeadline 为权威', () => {
    expect(projectReleaseDay(mk({ releaseDeadline: '2026-07-01', endDate: '2026-06-01', publishDate: '2026-05-01' }))).toBe('2026-07-01')
  })
  it('缺 releaseDeadline 回落 endDate，再回落 publishDate', () => {
    expect(projectReleaseDay(mk({ endDate: '2026-06-01', publishDate: '2026-05-01' }))).toBe('2026-06-01')
    expect(projectReleaseDay(mk({ publishDate: '2026-05-01' }))).toBe('2026-05-01')
  })
  it('都没有则 undefined', () => {
    expect(projectReleaseDay(mk())).toBeUndefined()
  })
})

describe('projectMonthKey', () => {
  it('取发布日的 YYYY-MM', () => {
    expect(projectMonthKey(mk({ releaseDeadline: '2026-07-15' }))).toBe('2026-07')
    expect(projectMonthKey(mk())).toBeUndefined()
  })
})

describe('isProjectOverdue', () => {
  const today = '2026-07-03'
  it('active 单（lead/confirmed）且发布日早于今天 → 逾期', () => {
    expect(isProjectOverdue(mk({ status: 'lead', releaseDeadline: '2026-07-01' }), today)).toBe(true)
    expect(isProjectOverdue(mk({ status: 'confirmed', releaseDeadline: '2026-07-02' }), today)).toBe(true)
  })
  it('已发布/已结算不算逾期（不管日期）', () => {
    expect(isProjectOverdue(mk({ status: 'published', releaseDeadline: '2026-01-01' }), today)).toBe(false)
    expect(isProjectOverdue(mk({ status: 'settled', releaseDeadline: '2026-01-01' }), today)).toBe(false)
  })
  it('发布日为今天或未来不算逾期', () => {
    expect(isProjectOverdue(mk({ status: 'lead', releaseDeadline: today }), today)).toBe(false)
    expect(isProjectOverdue(mk({ status: 'lead', releaseDeadline: '2026-07-10' }), today)).toBe(false)
  })
  it('无发布日不算逾期', () => {
    expect(isProjectOverdue(mk({ status: 'lead' }), today)).toBe(false)
  })
})

describe('projectsInMonth / projectsInYear / projectsPublishingOn', () => {
  const list = [
    mk({ id: 'a', releaseDeadline: '2026-07-01' }),
    mk({ id: 'b', releaseDeadline: '2026-07-31' }),
    mk({ id: 'c', releaseDeadline: '2026-08-01' }),
    mk({ id: 'd', publishDate: '2025-12-01' }),
    mk({ id: 'e' }), // 无日期
  ]
  it('按月过滤（以发布日归月）', () => {
    expect(projectsInMonth(list, '2026-07').map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('按年过滤', () => {
    expect(projectsInYear(list, 2026).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(projectsInYear(list, '2025').map((p) => p.id)).toEqual(['d'])
  })
  it('按具体某天的发布', () => {
    expect(projectsPublishingOn(list, '2026-07-01').map((p) => p.id)).toEqual(['a'])
    expect(projectsPublishingOn(list, '2026-07-15')).toEqual([])
  })
})
