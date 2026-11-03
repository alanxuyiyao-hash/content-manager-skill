import { describe, expect, it } from 'vitest'
import { mergeById, mergeTombstones, applyTombstones, normalizeTombstones } from './syncMerge'

describe('mergeById', () => {
  it('同 id 记录由 updatedAt 更新的一侧获胜', () => {
    const remote = [{ id: 'oh-1', amount: 100, updatedAt: 20 }]
    const local = [{ id: 'oh-1', amount: 80, updatedAt: 10 }]
    expect(mergeById(remote, local)).toEqual(remote)
    expect(mergeById(local, remote)).toEqual(remote)
  })

  it('不同 id 合并保留；旧记录都无 updatedAt 时保留本地', () => {
    const remote = [{ id: 'oh-1', amount: 100 }, { id: 'oh-2', amount: 200 }]
    const local = [{ id: 'oh-1', amount: 120 }, { id: 'oh-3', amount: 300 }]
    expect(mergeById(remote, local)).toEqual([
      { id: 'oh-1', amount: 120 },
      { id: 'oh-2', amount: 200 },
      { id: 'oh-3', amount: 300 },
    ])
  })
})

describe('mergeTombstones', () => {
  it('同 id 取 deletedAt 较大者', () => {
    const remote = [{ id: 'p-1', deletedAt: 10 }]
    const local = [{ id: 'p-1', deletedAt: 20 }]
    expect(mergeTombstones(remote, local)).toEqual(local)
    expect(mergeTombstones(local, remote)).toEqual(local)
  })

  it('不同 id 并集', () => {
    const remote = [{ id: 'p-1', deletedAt: 10 }]
    const local = [{ id: 'p-2', deletedAt: 20 }]
    expect(mergeTombstones(remote, local)).toEqual([
      { id: 'p-1', deletedAt: 10 },
      { id: 'p-2', deletedAt: 20 },
    ])
  })
})

describe('applyTombstones', () => {
  it('墓碑晚于记录 updatedAt → 记录被删、墓碑保留（继续传播）', () => {
    const records = [{ id: 'p-1', updatedAt: 10 }, { id: 'p-2', updatedAt: 10 }]
    const tombstones = [{ id: 'p-1', deletedAt: 20 }]
    expect(applyTombstones(records, tombstones)).toEqual({
      records: [{ id: 'p-2', updatedAt: 10 }],
      tombstones: [{ id: 'p-1', deletedAt: 20 }],
    })
  })

  it('删除后又被编辑（updatedAt > deletedAt）→ 记录保留、墓碑被丢弃', () => {
    const records = [{ id: 'p-1', updatedAt: 30 }]
    const tombstones = [{ id: 'p-1', deletedAt: 20 }]
    expect(applyTombstones(records, tombstones)).toEqual({
      records,
      tombstones: [],
    })
  })

  it('时间相等 → 删除胜（>= 语义，同毫秒编辑后立刻删）', () => {
    const records = [{ id: 'p-1', updatedAt: 20 }]
    const tombstones = [{ id: 'p-1', deletedAt: 20 }]
    expect(applyTombstones(records, tombstones)).toEqual({
      records: [],
      tombstones,
    })
  })

  it('无匹配记录的墓碑原样保留', () => {
    const tombstones = [{ id: 'p-gone', deletedAt: 20 }]
    expect(applyTombstones([{ id: 'p-1', updatedAt: 10 }], tombstones)).toEqual({
      records: [{ id: 'p-1', updatedAt: 10 }],
      tombstones,
    })
  })

  it('记录无 updatedAt（旧数据）视为 0 → 被删', () => {
    const records = [{ id: 'p-1' }]
    const tombstones = [{ id: 'p-1', deletedAt: 1 }]
    expect(applyTombstones(records, tombstones)).toEqual({
      records: [],
      tombstones,
    })
  })

  it('空墓碑（旧快照无 deletions 字段）→ 行为与现状一致', () => {
    const records = [{ id: 'p-1', updatedAt: 10 }]
    expect(applyTombstones(records, [])).toEqual({ records, tombstones: [] })
  })
})

describe('normalizeTombstones', () => {
  it('过滤非法项，缺失/非数组按空处理', () => {
    expect(normalizeTombstones(undefined)).toEqual([])
    expect(normalizeTombstones('x')).toEqual([])
    expect(
      normalizeTombstones([
        { id: 'p-1', deletedAt: 10 },
        { id: '', deletedAt: 10 },
        { id: 'p-2', deletedAt: Infinity },
        { id: 'p-3' },
        null,
        'junk',
      ]),
    ).toEqual([{ id: 'p-1', deletedAt: 10 }])
  })
})
