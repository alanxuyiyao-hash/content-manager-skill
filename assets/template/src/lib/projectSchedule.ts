import type { Project } from '../types'

/* ---------- 关键日期 ---------- */
// 发布日：releaseDeadline 为权威，旧数据回落 endDate/publishDate
export const projectReleaseDay = (p: Project): string | undefined =>
  p.releaseDeadline ?? p.endDate ?? p.publishDate

// 起始：显式 Start 日为权威；未填回退到发布日
export const projectStartDay = (p: Project): string | undefined =>
  p.startDate ?? projectReleaseDay(p)

export const projectMonthKey = (p: Project): string | undefined => projectReleaseDay(p)?.slice(0, 7)

export const projectTimelineRange = (p: Project): { start: string; end: string } | undefined => {
  const release = projectReleaseDay(p)
  const start = projectStartDay(p) ?? release
  if (!start && !release) return undefined
  return { start: start ?? release!, end: release ?? start! }
}

export function projectsInYear(projects: Project[], year: number | string): Project[] {
  const prefix = String(year)
  return projects.filter((p) => projectReleaseDay(p)?.startsWith(prefix))
}

export function projectsInMonth(projects: Project[], monthKey: string): Project[] {
  return projects.filter((p) => projectMonthKey(p) === monthKey)
}

// 某天发布的项目（发布日 = 权威发布日，从 stage.ts 迁入）
export function projectsPublishingOn(projects: Project[], dayKey: string): Project[] {
  return projects.filter((p) => projectReleaseDay(p) === dayKey)
}

// 逾期（纯展示判断）：Active 单(lead/confirmed)且权威发布日早于今天——本应发布却仍未发布/结算。
// today 由调用方传入(todayKey / useTodayKey)，保持纯函数、复用 projectReleaseDay，不改任何数据或口径。
export const isProjectOverdue = (p: Project, today: string): boolean => {
  if (p.status !== 'lead' && p.status !== 'confirmed') return false
  const day = projectReleaseDay(p)
  return !!day && day < today
}
