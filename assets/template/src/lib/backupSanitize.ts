import type { AdSpendGoal, AdSpendRecord, LedgerEntry, Project, ProjectStatus } from '../types'
import { isDateKey } from './date'

const STATUSES = new Set<ProjectStatus>(['lead', 'confirmed', 'published', 'settled'])
const AD_GOALS = new Set<AdSpendGoal>(['engagement', 'followers', 'views'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined

const number = (value: unknown, max = Number.POSITIVE_INFINITY): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : undefined

function sanitizeEntry(value: unknown): LedgerEntry | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  if (!id || (value.type !== 'income' && value.type !== 'expense')) return null
  return {
    id,
    type: value.type,
    amount: number(value.amount) ?? 0,
    category: text(value.category),
    date: isDateKey(value.date) ? value.date : undefined,
    note: text(value.note),
  }
}

// 投放记录：目标非法时回退 engagement（历史迁移同口径）而非丢弃——金额不能因脏数据蒸发
function sanitizeAdSpend(value: unknown): AdSpendRecord | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  if (!id) return null
  return {
    id,
    goal: AD_GOALS.has(value.goal as AdSpendGoal) ? (value.goal as AdSpendGoal) : 'engagement',
    amount: number(value.amount) ?? 0,
    date: isDateKey(value.date) ? value.date : undefined,
    note: text(value.note),
  }
}

export function sanitizeBackupProject(value: unknown): Project | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  if (!id) return null
  const status = STATUSES.has(value.status as ProjectStatus) ? (value.status as ProjectStatus) : 'lead'
  return {
    id,
    name: text(value.name) ?? '',
    icon: text(value.icon),
    status,
    isCommercial: typeof value.isCommercial === 'boolean' ? value.isCommercial : undefined,
    adQuote: number(value.adQuote),
    rebateRate: number(value.rebateRate, 100),
    adSpend: number(value.adSpend),
    adSpends: Array.isArray(value.adSpends)
      ? value.adSpends.map(sanitizeAdSpend).filter((record): record is AdSpendRecord => record !== null)
      : undefined,
    views: number(value.views),
    likes: number(value.likes),
    favorites: number(value.favorites),
    followersGained: number(value.followersGained),
    statsUpdatedAt: number(value.statsUpdatedAt),
    publishDate: isDateKey(value.publishDate) ? value.publishDate : undefined,
    startDate: isDateKey(value.startDate) ? value.startDate : undefined,
    endDate: isDateKey(value.endDate) ? value.endDate : undefined,
    releaseDeadline: isDateKey(value.releaseDeadline) ? value.releaseDeadline : undefined,
    entries: Array.isArray(value.entries)
      ? value.entries.map(sanitizeEntry).filter((entry): entry is LedgerEntry => entry !== null)
      : [],
    note: typeof value.note === 'string' ? value.note : '',
    review: typeof value.review === 'string' ? value.review : undefined,
    createdAt: number(value.createdAt) ?? 0,
    updatedAt: number(value.updatedAt) ?? 0,
  }
}

export function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
