export type SyncRecord = { id: string; updatedAt?: number }

// 删除墓碑：记录「什么时候删过哪个 id」，让合并能区分「本端删除」与「对端新增」。
export type Tombstone = { id: string; deletedAt: number }

// remote 先入表；同 id 时由 updatedAt 更新的一侧获胜。旧数据无 updatedAt 时本地优先。
export function mergeById<T extends SyncRecord>(remote: T[], local: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of remote) if (item && typeof item.id === 'string') map.set(item.id, item)
  for (const item of local) {
    if (!item || typeof item.id !== 'string') continue
    const previous = map.get(item.id)
    if (!previous || (item.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) map.set(item.id, item)
  }
  return Array.from(map.values())
}

// 同 id 墓碑取 deletedAt 较大者；不同 id 并集。
export function mergeTombstones(remote: Tombstone[], local: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>()
  for (const t of [...remote, ...local]) {
    const previous = map.get(t.id)
    if (!previous || t.deletedAt >= previous.deletedAt) map.set(t.id, t)
  }
  return Array.from(map.values())
}

// 墓碑仲裁：deletedAt >= 记录 updatedAt → 删记录、留墓碑（继续向对端传播）；
// 反之（删除后对端又编辑过）→ 记录获胜、丢墓碑，防止墓碑反复杀死已复活的记录。
export function applyTombstones<T extends SyncRecord>(
  records: T[],
  tombstones: Tombstone[],
): { records: T[]; tombstones: Tombstone[] } {
  const byId = new Map(tombstones.map((t) => [t.id, t]))
  const kept: T[] = []
  for (const item of records) {
    const t = byId.get(item.id)
    if (!t) {
      kept.push(item)
      continue
    }
    if (t.deletedAt >= (item.updatedAt ?? 0)) continue // 删除胜
    byId.delete(item.id) // 编辑胜 → 墓碑作废
    kept.push(item)
  }
  return { records: kept, tombstones: Array.from(byId.values()) }
}

export function normalizeTombstones(value: unknown): Tombstone[] {
  if (!Array.isArray(value)) return []
  const out: Tombstone[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { id, deletedAt } = item as { id?: unknown; deletedAt?: unknown }
    if (typeof id !== 'string' || !id) continue
    if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) continue
    out.push({ id, deletedAt })
  }
  return out
}
