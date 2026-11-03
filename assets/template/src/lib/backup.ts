import {
  db,
  getProfile,
  setProfile,
  normalizeProfile,
  normalizeOverheads,
  setOverheads,
  getOverheads,
  getTombstones,
  setTombstones,
} from '../db'
import type { Profile } from '../db'
import type { Project, Overhead } from '../types'
import { isDateKey } from './date'
import { sanitizeBackupProject, sanitizeStringRecord } from './backupSanitize'
import { mergeTombstones, normalizeTombstones, type Tombstone } from './syncMerge'

interface Backup {
  app: 'content-manager'
  version: number
  exportedAt: number
  projects: Project[]
  overheads?: Overhead[]
  profile?: Profile
  columnLabels?: Record<string, string>
  deletions?: Tombstone[]
}

export async function exportData(): Promise<Backup> {
  const [projects, overheads, columnLabelsSetting, profile, deletions] = await Promise.all([
    db.projects.toArray(),
    getOverheads(),
    db.settings.get('columnLabels'),
    getProfile(),
    getTombstones(),
  ])
  return {
    app: 'content-manager',
    version: 10,
    exportedAt: Date.now(),
    projects,
    overheads,
    columnLabels: (columnLabelsSetting?.value as Record<string, string> | undefined) ?? undefined,
    profile,
    deletions,
  }
}

// mode: 'merge' 按 id 覆盖/新增；'replace' 先清空再导入。
// 向后兼容：旧备份文件里的 cards/posts/events/inboxItems/inboxLists 字段会被静默忽略
// （这些实体已下线），只导入 projects/overheads/columnLabels/profile。
export async function importData(
  text: string,
  mode: 'merge' | 'replace',
): Promise<{ projects: number; overheads: number }> {
  let parsed: Partial<Backup>
  try {
    parsed = JSON.parse(text) as Partial<Backup>
  } catch {
    throw new Error('Invalid backup: not a valid JSON file')
  }
  if (!Array.isArray(parsed.projects)) {
    throw new Error('Invalid backup file: missing projects')
  }
  const projects = parsed.projects
    .map(sanitizeBackupProject)
    .filter((project): project is Project => project !== null)
  const overheads = normalizeOverheads(parsed.overheads).filter((o) => isDateKey(o.date))
  // 旧快照/旧备份文件无 deletions 字段 → 按空处理，行为与引入墓碑前一致
  const deletions = normalizeTombstones(parsed.deletions)

  await db.transaction('rw', [db.projects, db.settings], async () => {
    if (mode === 'replace') {
      await db.projects.clear()
      await setOverheads([])
      await db.settings.delete('columnLabels')
      await db.settings.delete('profile')
      await setTombstones(deletions)
    } else {
      await setTombstones(mergeTombstones(await getTombstones(), deletions))
    }
    if (projects.length) await db.projects.bulkPut(projects)

    if (overheads.length) {
      const current = mode === 'replace' ? [] : await getOverheads()
      const merged = new Map(current.map((item) => [item.id, item]))
      overheads.forEach((item) => merged.set(item.id, item))
      await setOverheads(Array.from(merged.values()))
    }

    const incoming = sanitizeStringRecord(parsed.columnLabels)
    if (incoming) {
      if (mode === 'replace') {
        await db.settings.put({ key: 'columnLabels', value: incoming })
      } else {
        const cur = (await db.settings.get('columnLabels'))?.value
        const base = cur && typeof cur === 'object' ? (cur as Record<string, string>) : {}
        await db.settings.put({ key: 'columnLabels', value: { ...base, ...incoming } })
      }
    }
    if (parsed.profile && typeof parsed.profile === 'object') {
      // 只写有值的键，避免用 undefined 覆盖掉当前已设的头像/简介
      const p = normalizeProfile(parsed.profile)
      const patch: Partial<Profile> = {}
      if (p.name !== undefined) patch.name = p.name
      if (p.bio !== undefined) patch.bio = p.bio
      if (p.avatar !== undefined) patch.avatar = p.avatar
      if (Object.keys(patch).length) await setProfile(patch)
    }

    // 末尾仲裁：保证「行与压倒它的墓碑不并存」。sync 路径传入的快照已在合并时仲裁过，
    // 此处是廉价 no-op；手动 merge 导入旧备份时靠这里真正生效。
    const finalTombstones = await getTombstones()
    if (finalTombstones.length) {
      const kept: Tombstone[] = []
      let ohList = await getOverheads()
      let ohChanged = false
      for (const t of finalTombstones) {
        const row = await db.projects.get(t.id)
        if (row) {
          if (t.deletedAt >= (row.updatedAt ?? 0)) {
            await db.projects.delete(t.id)
            kept.push(t)
          }
          continue
        }
        const oh = ohList.find((o) => o.id === t.id)
        if (oh) {
          if (t.deletedAt >= (oh.updatedAt ?? 0)) {
            ohList = ohList.filter((o) => o.id !== t.id)
            ohChanged = true
            kept.push(t)
          }
          continue
        }
        kept.push(t)
      }
      if (ohChanged) await setOverheads(ohList)
      if (kept.length !== finalTombstones.length) await setTombstones(kept)
    }
  })
  return { projects: projects.length, overheads: overheads.length }
}
