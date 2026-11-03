import { describe, expect, it } from 'vitest'
import { sanitizeBackupProject, sanitizeStringRecord } from './backupSanitize'

describe('sanitizeBackupProject', () => {
  it('只保留合法字段并夹紧金额、比例和日期', () => {
    const project = sanitizeBackupProject({
      id: ' p1 ',
      name: ' Demo ',
      status: 'broken',
      isCommercial: 'yes',
      adQuote: -100,
      rebateRate: 150,
      releaseDeadline: '2026-02-30',
      publishDate: '2026-07-03',
      entries: [
        { id: 'e1', type: 'expense', amount: -20, date: '2026-07-03' },
        { id: 'bad', type: 'other', amount: 10 },
      ],
      createdAt: 'yesterday',
      updatedAt: 12,
      injected: true,
    })
    expect(project).toEqual({
      id: 'p1',
      name: 'Demo',
      icon: undefined,
      status: 'lead',
      isCommercial: undefined,
      adQuote: 0,
      rebateRate: 100,
      adSpend: undefined,
      views: undefined,
      likes: undefined,
      favorites: undefined,
      followersGained: undefined,
      statsUpdatedAt: undefined,
      publishDate: '2026-07-03',
      startDate: undefined,
      endDate: undefined,
      releaseDeadline: undefined,
      entries: [{ id: 'e1', type: 'expense', amount: 0, category: undefined, date: '2026-07-03', note: undefined }],
      note: '',
      review: undefined,
      createdAt: 0,
      updatedAt: 12,
    })
  })

  it('缺少 id 的项目直接丢弃', () => {
    expect(sanitizeBackupProject({ name: 'No id' })).toBeNull()
  })

  it('投放记录 adSpends：夹紧金额/日期，非法目标回退 engagement，缺 id 丢弃', () => {
    const project = sanitizeBackupProject({
      id: 'p1',
      name: 'Demo',
      adSpends: [
        { id: 'as1', goal: 'followers', amount: 120, date: '2026-07-03', note: ' 追投 ' },
        { id: 'as2', goal: 'clicks', amount: -30, date: '2026-02-30' },
        { goal: 'views', amount: 50 },
      ],
    })
    expect(project?.adSpends).toEqual([
      { id: 'as1', goal: 'followers', amount: 120, date: '2026-07-03', note: '追投' },
      { id: 'as2', goal: 'engagement', amount: 0, date: undefined, note: undefined },
    ])
  })
})

describe('sanitizeStringRecord', () => {
  it('只保留字符串值', () => {
    expect(sanitizeStringRecord({ a: 'A', b: 2, c: null })).toEqual({ a: 'A' })
    expect(sanitizeStringRecord([])).toBeUndefined()
  })
})
