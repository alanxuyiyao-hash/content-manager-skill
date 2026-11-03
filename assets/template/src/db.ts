import Dexie, { type Table } from 'dexie'
import type { Project, Overhead } from './types'
import { toast } from './components/Toast'
import { normalizeTombstones, type Tombstone } from './lib/syncMerge'

export interface Setting {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  projects!: Table<Project, string>
  settings!: Table<Setting, string>

  constructor() {
    super('content-manager')
    // 历史版本 v1–v5 定义了 cards / events / posts / inspirations 等表，
    // 现已全部退役（收件箱/灵感库/个人事件/普通发布都已下线或并入 Project）。
    // 这里保留它们以保证旧用户升级时 schema 链不断；v6 把残留表显式删掉。
    this.version(1).stores({
      cards: 'id, status, publishDate, shootDate, updatedAt, createdAt',
      settings: 'key',
    })
    this.version(2).stores({
      cards: 'id, status, publishDate, shootDate, updatedAt, createdAt',
      settings: 'key',
      projects: 'id, status, publishDate, updatedAt, createdAt',
    })
    this.version(3).stores({
      cards: 'id, status, publishDate, shootDate, updatedAt, createdAt',
      settings: 'key',
      projects: 'id, status, publishDate, updatedAt, createdAt',
      inspirations: 'id, updatedAt, createdAt',
    })
    this.version(4).stores({
      cards: 'id, status, publishDate, shootDate, updatedAt, createdAt',
      settings: 'key',
      projects: 'id, status, publishDate, updatedAt, createdAt',
      inspirations: 'id, updatedAt, createdAt',
      events: 'id, date',
    })
    this.version(5).stores({
      inspirations: null,
      posts: 'id, date, updatedAt, createdAt',
    })
    // v6：退役所有死表。cards/posts/events 早已无代码读写（Post 已并入 Project，
    // 收件箱/灵感库/个人事件 UI 全下线）。显式置 null 在升级时真删表。
    this.version(6).stores({
      cards: null,
      posts: null,
      events: null,
    })
  }
}

export const db = new AppDB()

// 多 tab 兜底：新 tab 等升级被旧 tab 阻塞时给出提示（否则页面永久卡骨架）；
// 旧 tab 收到 versionchange 时主动关库并重载，解除阻塞源头。
db.on('blocked', () => toast('Update blocked by another open tab — close other tabs'))
db.on('versionchange', () => {
  db.close()
  location.reload()
})

export function genId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return prefix + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/* ---------- 固定支出 / 经营开销：复用 settings 存数组，免改 IndexedDB schema ---------- */
const OVERHEADS_KEY = 'overheads'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readOverhead(value: unknown): Overhead | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.date !== 'string' || !value.date) return null
  const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? Math.max(0, value.amount) : 0
  return {
    id: value.id,
    date: value.date,
    category: typeof value.category === 'string' && value.category.trim() ? value.category : 'Other',
    amount,
    note: typeof value.note === 'string' && value.note.trim() ? value.note : undefined,
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? Math.max(0, value.updatedAt)
        : undefined,
  }
}

export function normalizeOverheads(value: unknown): Overhead[] {
  if (!Array.isArray(value)) return []
  return value.map(readOverhead).filter((item): item is Overhead => item !== null)
}

export async function getOverheads(): Promise<Overhead[]> {
  const setting = await db.settings.get(OVERHEADS_KEY)
  return normalizeOverheads(setting?.value)
}

export async function setOverheads(items: Overhead[]): Promise<void> {
  await db.settings.put({ key: OVERHEADS_KEY, value: items })
}

export async function createOverhead(partial: Partial<Overhead> = {}): Promise<string> {
  const now = Date.now()
  const item: Overhead = {
    id: partial.id?.trim() || genId('oh'),
    date: partial.date?.trim() || new Date().toISOString().slice(0, 10),
    category: partial.category?.trim() || 'Tax',
    amount: typeof partial.amount === 'number' && Number.isFinite(partial.amount) ? Math.max(0, partial.amount) : 0,
    note: partial.note?.trim() || undefined,
    updatedAt: now,
  }
  await db.transaction('rw', db.settings, async () => {
    const items = await getOverheads()
    await setOverheads([item, ...items])
  })
  return item.id
}

export async function updateOverhead(id: string, patch: Partial<Overhead>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const items = await getOverheads()
    await setOverheads(items.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)))
  })
}

export async function deleteOverhead(id: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const items = await getOverheads()
    await setOverheads(items.filter((item) => item.id !== id))
    await addTombstone(id)
  })
}

/* ---------- 删除墓碑：同 overheads 存 settings 数组，供 sync 合并裁决「本端删除 vs 对端新增」 ---------- */
const DELETIONS_KEY = 'deletions'
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 3600_000

export async function getTombstones(): Promise<Tombstone[]> {
  const setting = await db.settings.get(DELETIONS_KEY)
  return normalizeTombstones(setting?.value)
}

export async function setTombstones(items: Tombstone[]): Promise<void> {
  await db.settings.put({ key: DELETIONS_KEY, value: items })
}

async function addTombstone(id: string): Promise<void> {
  const items = await getTombstones()
  await setTombstones([{ id, deletedAt: Date.now() }, ...items.filter((t) => t.id !== id)])
}

async function removeTombstone(id: string): Promise<void> {
  const items = await getTombstones()
  if (items.some((t) => t.id === id)) await setTombstones(items.filter((t) => t.id !== id))
}

export async function pruneTombstones(maxAgeMs = TOMBSTONE_MAX_AGE_MS): Promise<void> {
  const cutoff = Date.now() - maxAgeMs
  const items = await getTombstones()
  const kept = items.filter((t) => t.deletedAt >= cutoff)
  if (kept.length !== items.length) await setTombstones(kept)
}

/* ---------- 周期性开销识别（借鉴 Copilot）：纯派生，不读写、不碰任何金额/统计口径 ---------- */
// 视为「按月复现」的最少连续月数：连续 ≥3 个月同名同额才提示，稳妥避免误报。
export const RECURRING_MIN_MONTHS = 3

export interface RecurringOverheadHint {
  category: string // 同名依据（Overhead.category）
  amount: number // 同额依据
  note?: string // 沿用最近一条的备注，补录时带上
  lastDate: string // 最近一条的完整日期（YYYY-MM-DD），据此推算下月同日
  nextMonthKey: string // 建议补录的月份（YYYY-MM），仅展示用
}

// YYYY-MM 月键平移 delta 个月（纯字符串月算术，避开 Date 时区）
function shiftMonthKey(key: string, delta: number): string {
  const y = Number(key.slice(0, 4))
  const mo = Number(key.slice(5, 7))
  if (!y || !mo) return key
  const total = y * 12 + (mo - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 + 1 // 1..12
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/**
 * 找出「同名(category) + 同额(amount) + 连续若干月出现」且下月尚未记账的固定开销，
 * 给出补录下月的建议（可能多条，调用方通常取第一条做轻量提示）。
 * 纯展示/服务层派生：只读内存里的 overheads、用月份字符串比较，绝不改任何金额/统计口径。
 * @param currentMonthKey 今天的 YYYY-MM，用来把建议夹在「当月/下月」，不补久远历史空档。
 */
export function detectRecurringOverheads(
  overheads: Overhead[],
  currentMonthKey: string,
): RecurringOverheadHint[] {
  type Group = { category: string; amount: number; note?: string; lastDate: string; months: Set<string> }
  const groups = new Map<string, Group>()
  for (const o of overheads) {
    const category = o.category.trim()
    if (!category || !(o.amount > 0)) continue
    const key = JSON.stringify([category, o.amount]) // 稳妥分组键：避开科目名带数字的键冲突
    const month = o.date.slice(0, 7)
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { category, amount: o.amount, note: o.note, lastDate: o.date, months: new Set([month]) })
    } else {
      g.months.add(month)
      if (o.date > g.lastDate) {
        g.lastDate = o.date
        g.note = o.note // 备注取最近一条
      }
    }
  }
  const prevMonth = shiftMonthKey(currentMonthKey, -1)
  const nextCap = shiftMonthKey(currentMonthKey, 1)
  const hints: RecurringOverheadHint[] = []
  for (const g of groups.values()) {
    const last = g.lastDate.slice(0, 7)
    if (last < prevMonth) continue // 太旧（疑似已停付）→ 不补历史空档
    // 从最近月往前数连续出现的月数（同月多笔按 Set 去重，不会虚高）
    let streak = 0
    let m = last
    while (g.months.has(m)) {
      streak += 1
      m = shiftMonthKey(m, -1)
    }
    if (streak < RECURRING_MIN_MONTHS) continue
    const nextMonthKey = shiftMonthKey(last, 1)
    if (nextMonthKey > nextCap) continue // 只建议到「下月」为止，不追未来
    if (g.months.has(nextMonthKey)) continue // 下月已记同项 → 不重复补录
    hints.push({ category: g.category, amount: g.amount, note: g.note, lastDate: g.lastDate, nextMonthKey })
  }
  // 最近、金额大的优先（调用方取第一条即可）
  hints.sort((a, b) => b.nextMonthKey.localeCompare(a.nextMonthKey) || b.amount - a.amount)
  return hints
}

/* ---------- 项目 / 商单 ---------- */
export async function createProject(partial: Partial<Project> = {}): Promise<string> {
  const now = Date.now()
  const p: Project = {
    id: partial.id?.trim() || genId('p'),
    name: (partial.name ?? '').trim(),
    icon: partial.icon,
    status: partial.status ?? 'lead',
    isCommercial: partial.isCommercial ?? false,
    adQuote: partial.adQuote,
    rebateRate: partial.rebateRate,
    adSpend: partial.adSpend,
    adSpends: partial.adSpends,
    publishDate: partial.publishDate,
    startDate: partial.startDate,
    endDate: partial.endDate,
    releaseDeadline: partial.releaseDeadline,
    entries: partial.entries ?? [],
    note: partial.note ?? '',
    review: partial.review,
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.add(p)
  return p.id
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const n = await db.projects.update(id, { ...patch, updatedAt: Date.now() })
  if (n === 0) toast('Record not found — it may have been deleted')
}

// 内容表现数据（views/likes/…）录入：顺手盖上 statsUpdatedAt——「数据 n 天前更新」的语义时钟，
// 独立于 updatedAt（后者是 sync 合并裁决位，任何字段编辑都会刷新）
export async function updateProjectStats(
  id: string,
  patch: Pick<Partial<Project>, 'views' | 'likes' | 'favorites' | 'followersGained'>,
): Promise<void> {
  await updateProject(id, { ...patch, statsUpdatedAt: Date.now() })
}

export async function deleteProject(id: string): Promise<Project | undefined> {
  return db.transaction('rw', [db.projects, db.settings], async () => {
    const snap = await db.projects.get(id)
    await db.projects.delete(id)
    if (snap) await addTombstone(id)
    return snap
  })
}

// Undo：刷新 updatedAt 使其压过已推送到云端的墓碑（合并裁决「编辑胜」），否则会被再删一次。
export async function restoreProject(project: Project): Promise<void> {
  await db.transaction('rw', [db.projects, db.settings], async () => {
    await db.projects.put({ ...project, updatedAt: Date.now() })
    await removeTombstone(project.id)
  })
}

/* ---------- 个人资料：头像/名字存 settings，随备份导出 ---------- */
export interface Profile {
  name?: string
  bio?: string
  avatar?: string // 压缩后的 base64 头像
}
const PROFILE_KEY = 'profile'

export function normalizeProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') return {}
  const v = value as Profile
  return {
    name: typeof v.name === 'string' ? v.name : undefined,
    bio: typeof v.bio === 'string' ? v.bio : undefined,
    avatar: typeof v.avatar === 'string' ? v.avatar : undefined,
  }
}

export async function getProfile(): Promise<Profile> {
  return normalizeProfile((await db.settings.get(PROFILE_KEY))?.value)
}

export async function setProfile(patch: Partial<Profile>): Promise<void> {
  const current = await getProfile()
  await db.settings.put({ key: PROFILE_KEY, value: { ...current, ...patch } })
}
