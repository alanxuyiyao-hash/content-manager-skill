import { describe, it, expect } from 'vitest'
import type { Project } from '../types'
import { publishedInMonth, monthContentSummary, momDelta, adsVsOwn, cadence } from './contentStats'

let seq = 0
const mk = (partial: Partial<Project> = {}): Project => ({
  id: `p${++seq}`,
  name: 'X',
  status: 'published',
  entries: [],
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...partial,
})

describe('publishedInMonth — 与 Stats 页 publishStats 同口径', () => {
  it('只收 published/settled 且发布日在该月', () => {
    const list = [
      mk({ status: 'published', releaseDeadline: '2026-06-10' }),
      mk({ status: 'settled', publishDate: '2026-06-20' }),
      mk({ status: 'confirmed', releaseDeadline: '2026-06-15' }), // 未发布不进
      mk({ status: 'published', releaseDeadline: '2026-05-31' }), // 上月不进
      mk({ status: 'published' }), // 无发布日不进
    ]
    expect(publishedInMonth(list, '2026-06')).toHaveLength(2)
  })
  it('发布日优先级走 projectReleaseDay：releaseDeadline 压过 publishDate', () => {
    const p = mk({ status: 'published', releaseDeadline: '2026-07-01', publishDate: '2026-06-10' })
    expect(publishedInMonth([p], '2026-06')).toHaveLength(0)
    expect(publishedInMonth([p], '2026-07')).toHaveLength(1)
  })
})

describe('monthContentSummary — tracked 覆盖率与均值', () => {
  it('viewsAvg 分母是已录条数，不是全部条数', () => {
    const s = monthContentSummary(
      [
        mk({ releaseDeadline: '2026-06-01', views: 1000, likes: 50, favorites: 20, followersGained: 12 }),
        mk({ releaseDeadline: '2026-06-05', views: 3000, likes: 80, favorites: 40 }),
        mk({ releaseDeadline: '2026-06-09', followersGained: 8 }), // 未录 views
      ],
      '2026-06',
    )
    expect(s.count).toBe(3)
    expect(s.viewsTracked).toBe(2)
    expect(s.viewsTotal).toBe(4000)
    expect(s.viewsAvg).toBe(2000)
    expect(s.viewsMedian).toBe(2000)
    expect(s.likesTotal).toBe(130)
    expect(s.favoritesTotal).toBe(60)
    expect(s.engagementTracked).toBe(2)
    expect(s.engagementTotal).toBe(190)
    expect(s.engagementMedian).toBe(95)
    expect(s.followersGainedTracked).toBe(2)
    expect(s.followersGainedTotal).toBe(20)
    expect(s.followersGainedAvg).toBe(10)
  })
  it('一条没录 views → viewsAvg 为 null 而非 0', () => {
    const s = monthContentSummary([mk({ releaseDeadline: '2026-06-01' })], '2026-06')
    expect(s.viewsTracked).toBe(0)
    expect(s.viewsAvg).toBeNull()
    expect(s.viewsMedian).toBeNull()
    expect(s.engagementTracked).toBe(0)
    expect(s.engagementMedian).toBeNull()
    expect(s.followersGainedTracked).toBe(0)
    expect(s.followersGainedAvg).toBeNull()
  })
  it('engagement 中位数 = 每条笔记 likes + favorites，再取中位数', () => {
    const s = monthContentSummary(
      [
        mk({ releaseDeadline: '2026-06-01', likes: 100, favorites: 20 }),
        mk({ releaseDeadline: '2026-06-02', likes: 300, favorites: 60 }),
        mk({ releaseDeadline: '2026-06-03', likes: 900, favorites: 100 }),
        mk({ releaseDeadline: '2026-06-04', likes: 999 }), // 缺 favorites，不进中位数样本
      ],
      '2026-06',
    )
    expect(s.engagementTracked).toBe(3)
    expect(s.engagementTotal).toBe(1480)
    expect(s.engagementMedian).toBe(360)
  })
  it('ads/own 按 isCommercial 拆分', () => {
    const s = monthContentSummary(
      [
        mk({ releaseDeadline: '2026-06-01', isCommercial: true }),
        mk({ releaseDeadline: '2026-06-02', isCommercial: false }),
      ],
      '2026-06',
    )
    expect(s.adsCount).toBe(1)
    expect(s.ownCount).toBe(1)
  })
})

describe('momDelta — 环比防除零', () => {
  it('正常环比', () => {
    expect(momDelta(120, 100)).toBe(20)
    expect(momDelta(80, 100)).toBe(-20)
  })
  it('上月 0 或无数据 → null', () => {
    expect(momDelta(120, 0)).toBeNull()
    expect(momDelta(120, null)).toBeNull()
    expect(momDelta(null, 100)).toBeNull()
  })
})

describe('adsVsOwn — 只比内容表现', () => {
  it('各侧均值分母为该侧已录条数；零样本侧 → null', () => {
    const { ads, own } = adsVsOwn([
      mk({ isCommercial: true, views: 1000, followersGained: 12 }),
      mk({ isCommercial: true }), // 商单但未录
      mk({ isCommercial: false, views: 5000, followersGained: 80 }),
    ])
    expect(ads.count).toBe(2)
    expect(ads.avgViews).toBe(1000)
    expect(ads.avgFollowersGained).toBe(12)
    expect(own.count).toBe(1)
    expect(own.avgViews).toBe(5000)
    expect(own.avgFollowersGained).toBe(80)
  })
})

describe('cadence — 最近 30 天发布节奏', () => {
  const post = (day: string, extra: Partial<Project> = {}) => mk({ releaseDeadline: day, ...extra })

  it('只统计过去 30 天窗口内的 published/settled，窗口两端都包含', () => {
    const c = cadence(
      [
        post('2026-06-06'), // 左端包含：end=7/5 时 30 天窗口从 6/6 开始
        post('2026-06-07'),
        post('2026-07-05'),
        post('2026-07-06'), // 未来，不进
        post('2026-06-12', { status: 'confirmed' }), // 未发布，不进
      ],
      '2026-07-05',
    )
    expect(c.startKey).toBe('2026-06-06')
    expect(c.endKey).toBe('2026-07-05')
    expect(c.count).toBe(3)
  })
  it('发布日去重升序，间隔和 last 统计正确', () => {
    const c = cadence(
      [
        post('2026-06-10'),
        post('2026-06-10'),
        post('2026-06-17'),
        post('2026-07-05'),
      ],
      '2026-07-06',
    )
    expect(c.count).toBe(4)
    expect(c.days.map((d) => d.key)).toEqual(['2026-06-10', '2026-06-17', '2026-07-05'])
    expect(c.days.map((d) => d.offset)).toEqual([3, 10, 28])
    expect(c.avgGap).toBeCloseTo(12.5)
    expect(c.maxGap).toBe(18)
    expect(c.lastGap).toBe(1)
  })
  it('同日多条只要有商单该点即记 ads', () => {
    const c = cadence(
      [
        post('2026-07-05', { isCommercial: false }),
        post('2026-07-05', { isCommercial: true }),
      ],
      '2026-07-06',
    )
    // 同日两条合并成一点，任一商单 → ads=true；items 携带当天全部内容（2 条）
    expect(c.days.map(({ key, offset, ads, items }) => ({ key, offset, ads, n: items.length }))).toEqual([
      { key: '2026-07-05', offset: 28, ads: true, n: 2 },
    ])
  })
  it('不足 2 个发布日无间隔读数，但仍有 last', () => {
    const c = cadence([post('2026-07-05')], '2026-07-06')
    expect(c.avgGap).toBeNull()
    expect(c.maxGap).toBeNull()
    expect(c.lastGap).toBe(1)
  })
  it('无发布时读数为空', () => {
    const c = cadence([], '2026-07-06')
    expect(c.count).toBe(0)
    expect(c.days).toEqual([])
    expect(c.avgGap).toBeNull()
    expect(c.maxGap).toBeNull()
    expect(c.lastGap).toBeNull()
  })
})
