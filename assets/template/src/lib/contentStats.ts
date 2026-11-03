import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns'
import type { Project } from '../types'
import { projectReleaseDay } from './projectSchedule'
import { isCommercialProject } from './money'

/* ---------- Insights 页的内容表现口径（纯派生，零财务） ----------
 * 只处理发布后的内容数据（views/likes/favorites/followersGained）与发布节奏；
 * 收入/投流/净利等财务口径全在 money.ts / Stats 页，这里一概不碰——
 * 唯一从 money.ts 借的是 isCommercialProject（商单身份判定，非金额）。 */

// 「某月已发布」：status published/settled 且权威发布日落在该月——与 Stats 页 Posts 卡(publishStats)同口径
export function publishedInMonth(projects: Project[], monthKey: string): Project[] {
  return projects.filter(
    (p) =>
      (p.status === 'published' || p.status === 'settled') &&
      !!projectReleaseDay(p)?.startsWith(monthKey),
  )
}

export function publishedInRange(projects: Project[], startKey: string, endKey: string): Project[] {
  return projects.filter((p) => {
    const day = projectReleaseDay(p)
    return (p.status === 'published' || p.status === 'settled') && !!day && day >= startKey && day <= endKey
  })
}

export interface MonthContentSummary {
  count: number
  adsCount: number
  ownCount: number
  viewsTotal: number
  viewsTracked: number // 已录 views 的条数：覆盖率读数（"3 of 5 tracked"）
  viewsAvg: number | null // total / tracked；一条没录 → null（显 "—"，不假装 0）
  viewsMedian: number | null // 本月发布笔记的播放中位数；只算已录 views 的笔记
  likesTotal: number
  favoritesTotal: number
  engagementTotal: number // likes + favorites 合计
  engagementTracked: number // likes/favorites 都已录的条数；缺任一项不拿 0 假补
  engagementMedian: number | null // 每条笔记 (likes + favorites) 的中位数
  followersGainedTotal: number
  followersGainedTracked: number // 已录涨粉的条数：覆盖率读数（"3 of 5 tracked"）
  followersGainedAvg: number | null
}

const count = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null

const sumBy = (list: Project[], f: (p: Project) => number | null): number =>
  list.reduce((s, p) => s + (f(p) ?? 0), 0)

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function monthContentSummary(projects: Project[], monthKey: string): MonthContentSummary {
  const published = publishedInMonth(projects, monthKey)
  const adsCount = published.filter(isCommercialProject).length
  const tracked = published.filter((p) => count(p.views) !== null)
  const viewsTotal = sumBy(tracked, (p) => count(p.views))
  const engagementRows = published
    .map((p) => {
      const likes = count(p.likes)
      const favorites = count(p.favorites)
      return likes !== null && favorites !== null ? likes + favorites : null
    })
    .filter((v): v is number => v !== null)
  const followerTracked = published.filter((p) => count(p.followersGained) !== null)
  const followersGainedTotal = sumBy(followerTracked, (p) => count(p.followersGained))
  return {
    count: published.length,
    adsCount,
    ownCount: published.length - adsCount,
    viewsTotal,
    viewsTracked: tracked.length,
    viewsAvg: tracked.length > 0 ? viewsTotal / tracked.length : null,
    viewsMedian: median(tracked.map((p) => count(p.views) ?? 0)),
    likesTotal: sumBy(published, (p) => count(p.likes)),
    favoritesTotal: sumBy(published, (p) => count(p.favorites)),
    engagementTotal: engagementRows.reduce((s, v) => s + v, 0),
    engagementTracked: engagementRows.length,
    engagementMedian: median(engagementRows),
    followersGainedTotal,
    followersGainedTracked: followerTracked.length,
    followersGainedAvg: followerTracked.length > 0 ? followersGainedTotal / followerTracked.length : null,
  }
}

// 环比（%）：上月无数/为 0 → null（渲染 "—"，除零会给出 ∞ 的误导读数）
export function momDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

export interface SideStats {
  count: number
  avgViews: number | null // 均值分母 = 该侧已录该指标的条数；零样本 → null
  avgFollowersGained: number | null
  medianViews: number | null // 中位数：比均值更诚实（不被一条爆款拉偏）
  medianEngagement: number | null // 每条 (likes + favorites) 的中位数；两项都录才算
  medianFollowersGained: number | null
}

// 商单 vs 自制：只比内容表现（条数/播放/涨粉），不比钱。中位数为主、均值为辅。
export function adsVsOwn(published: Project[]): { ads: SideStats; own: SideStats } {
  const side = (list: Project[]): SideStats => {
    const valuesOf = (f: (p: Project) => number | null): number[] =>
      list.map(f).filter((v): v is number => v !== null)
    const avg = (vals: number[]): number | null => (vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null)
    const views = valuesOf((p) => count(p.views))
    const followers = valuesOf((p) => count(p.followersGained))
    // 互动量 = likes + favorites；两项都录才算进中位数
    const engagement = list
      .map((p) => {
        const likes = count(p.likes)
        const favorites = count(p.favorites)
        return likes !== null && favorites !== null ? likes + favorites : null
      })
      .filter((v): v is number => v !== null)
    return {
      count: list.length,
      avgViews: avg(views),
      avgFollowersGained: avg(followers),
      medianViews: median(views),
      medianEngagement: median(engagement),
      medianFollowersGained: median(followers),
    }
  }
  return {
    ads: side(published.filter(isCommercialProject)),
    own: side(published.filter((p) => !isCommercialProject(p))),
  }
}

export interface CadenceDay {
  key: string // YYYY-MM-DD 发布日
  offset: number // 距窗口起的天数
  ads: boolean // 该日任一商单 → true（决定点的配色）
  items: Project[] // 该日发布的全部内容（tooltip 用：标题里自带 EPxxx）
}
export interface Cadence {
  days: CadenceDay[] // 滚动窗口内发布日；同日多条并成一点，任一商单则记 ads
  count: number // 滚动窗口内发布条数；同日多条照实计数
  avgGap: number | null // 相邻发布日平均间隔（天）；不足 2 个发布日 → null
  maxGap: number | null
  lastGap: number | null // 距离最近一次发布的天数；无发布 → null
  windowDays: number
  startKey: string
  endKey: string
}

// 发布节奏：Home 用滚动窗口看最近是否断更，不跟自然月绑定。
export function cadence(projects: Project[], endKey: string, windowDays = 30): Cadence {
  const daysInWindow = Math.max(1, Math.floor(windowDays))
  const endDate = parseISO(endKey)
  const startDate = subDays(endDate, daysInWindow - 1)
  const startKey = format(startDate, 'yyyy-MM-dd')
  const published = publishedInRange(projects, startKey, endKey)
  const byDay = new Map<string, { ads: boolean; items: Project[] }>()
  for (const p of published) {
    const day = projectReleaseDay(p)!
    const entry = byDay.get(day)
    if (entry) {
      entry.ads = entry.ads || isCommercialProject(p)
      entry.items.push(p)
    } else {
      byDay.set(day, { ads: isCommercialProject(p), items: [p] })
    }
  }
  const days = Array.from(byDay, ([key, { ads, items }]) => ({
    key,
    offset: differenceInCalendarDays(parseISO(key), startDate),
    ads,
    items,
  })).sort((a, b) => a.offset - b.offset)
  const gaps = days.slice(1).map((d, i) => d.offset - days[i].offset)
  const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : null
  const last = days[days.length - 1]
  const lastGap = last ? differenceInCalendarDays(endDate, parseISO(last.key)) : null
  return { days, count: published.length, avgGap, maxGap, lastGap, windowDays: daysInWindow, startKey, endKey }
}
