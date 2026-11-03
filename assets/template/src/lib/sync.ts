import { db, pruneTombstones } from '../db'
import { exportData, importData } from './backup'
import { supabase, isSupabaseConfigured } from './supabase'
import { mergeById, mergeTombstones, applyTombstones } from './syncMerge'

// 整包 JSON 云同步：复用现成的 exportData/importData。
// - 启动（登录后）拉一次远端，与本地按记录合并 → 拿到最新且不丢本地未推送的改动
// - 本地任意数据表变动 → 防抖 ~3s 推一次整包
// 冲突模型：云端 updated_at 做 CAS；发现并发修改时，项目和固定支出按记录 updatedAt 合并。
// 删除经墓碑（快照 deletions 字段）传播：deletedAt 对记录 updatedAt 仲裁，不再被旧快照复活。
const TABLE = 'app_state'
const DEBOUNCE_MS = 3000

export type SyncState = 'idle' | 'syncing' | 'error' | 'disabled'
export interface SyncStatus {
  state: SyncState
  lastSyncedAt: number | null
  message?: string
}

let status: SyncStatus = {
  state: isSupabaseConfigured ? 'idle' : 'disabled',
  lastSyncedAt: null,
}
const listeners = new Set<(s: SyncStatus) => void>()

export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => {
    listeners.delete(fn)
  }
}
export function getSyncStatus(): SyncStatus {
  return status
}
function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  listeners.forEach((fn) => fn(status))
}

let enabled = false // 登录后才开始同步；退出登录后停止
let hooksAttached = false
let applyingRemote = false // 拉取/写入本地期间，别把 Dexie 钩子触发当成用户改动
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingPush = false
let pushTask: Promise<boolean> | null = null
let lifecycleHandlersAttached = false
// 乐观锁基线：上次成功 pull/push 时云端那一行的 updated_at。
// push 前若云端的 updated_at ≠ 此值，说明另一台设备在我们之后改过 → 先按记录合并再写回。
let baseRev: string | null = null

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

// 从云端拉取整包，与本地按记录合并后落盘。
// 合并而非整包替换：本地在防抖窗口内未推送的编辑/删除墓碑不会被云端旧快照冲掉；
// 合并结果与云端有差异时回推，把本地墓碑/编辑传播出去。
export async function pullRemote(): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  const { data, error } = await supabase
    .from(TABLE)
    .select('data, updated_at')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) {
    setStatus({ state: 'error', message: error.message })
    throw error
  }
  const remoteRev = (data?.updated_at as string | null) ?? null
  if (data?.data && remoteRev !== baseRev) {
    const remote = data.data as Snapshot
    const merged = mergeSnapshots(await exportData(), remote)
    applyingRemote = true
    try {
      await importData(JSON.stringify(merged), 'replace')
    } finally {
      applyingRemote = false
    }
    baseRev = remoteRev
    if (!sameSnapshot(merged, remote)) scheduleSync()
  } else {
    baseRev = remoteRev
  }
  setStatus({ state: 'idle', lastSyncedAt: Date.now() })
}

type Snapshot = Awaited<ReturnType<typeof exportData>>

// 键序无关的深度规范化：Supabase JSONB 会重排对象键序，直接 stringify 比较会误判差异。
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k])
    return out
  }
  return value
}

// 数据字段比较（跳过 exportedAt/version），避免每次启动无谓回推抬高 updated_at 引发其它设备连环 re-pull。
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  const pick = (s: Snapshot) =>
    JSON.stringify(
      canonical({
        projects: s.projects ?? [],
        overheads: s.overheads ?? [],
        columnLabels: s.columnLabels ?? {},
        profile: s.profile ?? {},
        deletions: s.deletions ?? [],
      }),
    )
  return pick(a) === pick(b)
}

// 把本地与远端两份整包按记录合并（last-write-wins per record），再用墓碑仲裁删除：
// 墓碑 deletedAt >= 记录 updatedAt → 删；删除后又被编辑 → 记录胜、墓碑作废。
function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  const tombstones = mergeTombstones(remote.deletions ?? [], local.deletions ?? [])
  const p = applyTombstones(mergeById(remote.projects ?? [], local.projects ?? []), tombstones)
  const o = applyTombstones(mergeById(remote.overheads ?? [], local.overheads ?? []), p.tombstones)
  return {
    ...local,
    projects: p.records,
    overheads: o.records,
    columnLabels: { ...(remote.columnLabels ?? {}), ...(local.columnLabels ?? {}) },
    profile: local.profile ?? remote.profile,
    deletions: o.tombstones,
  }
}

// 把当前本地整包推到云端：CAS 乐观锁 + 冲突时按记录合并，避免整包 last-write-wins 吞掉另一台设备的改动。
async function pushOnce(uid: string): Promise<boolean> {
  setStatus({ state: 'syncing' })
  try {
    await pushWithMerge(uid)
    setStatus({ state: 'idle', lastSyncedAt: Date.now(), message: undefined })
    return true
  } catch (err) {
    setStatus({ state: 'error', message: (err as Error).message })
    return false
  }
}

async function runPushLoop(): Promise<boolean> {
  let success = true
  do {
    pendingPush = false
    const uid = await currentUserId()
    if (!uid) return true
    success = await pushOnce(uid)
  } while (success && pendingPush)
  return success
}

export async function pushRemote(): Promise<boolean> {
  if (pushTask) {
    pendingPush = true
    return pushTask
  }
  const task = runPushLoop()
  pushTask = task
  try {
    return await task
  } finally {
    pushTask = null
  }
}

async function pushWithMerge(uid: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row, error: e1 } = await supabase
      .from(TABLE)
      .select('data, updated_at')
      .eq('user_id', uid)
      .maybeSingle()
    if (e1) throw e1
    const remoteRev: string | null = (row?.updated_at as string | null) ?? null

    let payload = await exportData()
    // 云端在我们上次同步之后被另一台设备改过 → 先按记录合并，本地也更新成合并结果
    if (remoteRev && remoteRev !== baseRev && row?.data) {
      const merged = mergeSnapshots(payload, row.data as Snapshot)
      applyingRemote = true
      try {
        await importData(JSON.stringify(merged), 'replace')
      } finally {
        applyingRemote = false
      }
      payload = merged
    }

    const newRev = new Date().toISOString()
    if (remoteRev === null) {
      const { error: e2 } = await supabase.from(TABLE).insert({ user_id: uid, data: payload, updated_at: newRev })
      if (e2) {
        if ((e2 as { code?: string }).code === '23505') continue // 并发插入撞唯一键 → 重试走 update 分支
        throw e2
      }
      baseRev = newRev
      return
    }
    // CAS：仅当云端 updated_at 仍等于刚读到的值时才更新；命中 0 行说明又有人插队，重试合并
    const { data: updated, error: e3 } = await supabase
      .from(TABLE)
      .update({ data: payload, updated_at: newRev })
      .eq('user_id', uid)
      .eq('updated_at', remoteRev)
      .select('user_id')
    if (e3) throw e3
    if (!updated || updated.length === 0) continue
    baseRev = newRev
    return
  }
  throw new Error('Sync conflict: retries exhausted')
}

export function scheduleSync(): void {
  if (!enabled || applyingRemote) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void pushRemote()
  }, DEBOUNCE_MS)
}

// 立刻把待推送的整包刷出去（不等满 3s 防抖）。
// 移动端切后台/锁屏/划掉 PWA 时 iOS 会挂起 JS 定时器，pending 的 push 会被吞，
// 这里在页面隐藏的瞬间抢推一次，把"编辑完马上退出就丢"的窗口压到最小。
function flushPending(): void {
  if (!enabled) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    void pushRemote()
  }
}

// 退出登录前调用：把待推送内容 await 推完再走，避免会话失效后 push 失败丢数据。
export async function flushSync(): Promise<void> {
  if (!enabled) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const success = await pushRemote()
  if (!success) throw new Error(status.message ?? 'Sync failed')
}

function attachHooks(): void {
  if (hooksAttached) return
  hooksAttached = true
  // overheads / profile / columnLabels 都存在 settings 表，钩 settings 即覆盖全部数据。
  const tables = [db.projects, db.settings]
  for (const t of tables) {
    t.hook('creating', () => {
      scheduleSync()
    })
    t.hook('updating', () => {
      scheduleSync()
    })
    t.hook('deleting', () => {
      scheduleSync()
    })
  }
}

let onlineHandlerAttached = false

// 登录成功后调用：拉取最新 + 开始监听本地改动。
export async function startSync(): Promise<void> {
  if (!isSupabaseConfigured) return
  enabled = true
  attachHooks()
  if (!onlineHandlerAttached) {
    onlineHandlerAttached = true
    window.addEventListener('online', () => scheduleSync())
  }
  if (!lifecycleHandlersAttached) {
    lifecycleHandlersAttached = true
    // 页面隐藏（切后台/锁屏/切 App）瞬间立即刷出待推送，避免 3s 防抖被 iOS 挂起吞掉
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending()
    })
    window.addEventListener('pagehide', () => flushPending())
  }
  try {
    await pruneTombstones()
  } catch {
    // 清理失败不阻塞同步
  }
  try {
    await pullRemote()
  } catch {
    // pullRemote 已设置 error 状态
  }
}

// 退出登录时调用：停止推送。
export function stopSync(): void {
  enabled = false
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  setStatus({ state: 'idle' })
}
