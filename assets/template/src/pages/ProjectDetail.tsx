import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, genId, createProject, updateProject, deleteProject, restoreProject } from '../db'
import type { AdSpendGoal, AdSpendRecord, EntryType, LedgerEntry, Project, ProjectStage, ProjectStatus } from '../types'
import {
  PROJECT_STAGE_META,
  PROJECT_STAGE_ORDER,
  stageOf,
  isPaid,
  INCOME_CATEGORIES,
  catLabel,
  AD_SPEND_GOALS,
  AD_SPEND_GOAL_LABELS,
} from '../types'
import {
  formatMoney,
  isCommercialProject,
  isAdSpendEntry,
  projectQuote,
  projectRebateRate,
  projectAdIncome,
  projectAdSpend,
  projectAdSpendEntries,
  projectOtherIncome,
  projectOtherExpense,
  projectIncome,
  projectExpense,
  projectNet,
} from '../lib/money'
import { Money } from '../lib/privacy'
import { useCurrencySymbol } from '../lib/currency'
import { PROJECT_ICONS, avatarTone, avatarInitial } from '../lib/avatar'
import { haptic } from '../lib/haptics'
import { todayKey, prettyDate } from '../lib/date'
import Sheet from '../components/Sheet'
import ConfirmDialog from '../components/ConfirmDialog'
import DatePicker from '../components/DatePicker'
import { XIcon } from '../components/AppHeader'
import { toast } from '../components/Toast'
import type { ProjectEditor } from '../App'
import { DEMO_PROJECTS } from '../lib/demo'

function CalIcon() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  )
}

// 未选 icon 时的占位提示：一张笑脸轮廓，示意「点这里挑个 emoji 头像」
function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9" cy="10.5" r="1.1" />
      <circle cx="15" cy="10.5" r="1.1" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    </svg>
  )
}

// 品牌 emoji 头像快捷面板选项：与新建入口(QuickCapture)同源 PROJECT_ICONS，保证两处一致。

const EMPTY: Project = {
  id: '',
  name: '',
  status: 'lead',
  isCommercial: false,
  adQuote: 0,
  rebateRate: 0,
  adSpend: 0,
  adSpends: [],
  publishDate: undefined,
  startDate: undefined,
  endDate: undefined,
  entries: [],
  note: '',
  createdAt: 0,
  updatedAt: 0,
}

// 双轴状态控件——生产阶段段（三档）：Planned / Producing / Published，分别写底层枚举 lead / confirmed / published。
// 收款轴独立：Published 段旁出 Paid 开关（开→settled、关→published）。label/色复用 PROJECT_STAGE_META，不引入新配色。
const STAGE_TIERS: { id: ProjectStage; label: string; color: string }[] = PROJECT_STAGE_ORDER.map(
  (id) => ({ id, label: PROJECT_STAGE_META[id].label, color: PROJECT_STAGE_META[id].color }),
)

const cleanAmount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0)
const cleanRate = (n: unknown): number => Math.min(100, cleanAmount(n))
const fmtMoney = (n: unknown): string => {
  const v = cleanAmount(n)
  return v > 0 ? String(v) : ''
}
// 失焦后的展示态：加千分位（纯展示，不改存储值）。聚焦时回落到裸数字以便编辑。
const fmtThousands = (n: unknown): string => {
  const v = cleanAmount(n)
  return v > 0 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''
}

// 一次性迁移：旧「adSpend 单值 + expense 流水」→ 逐笔投放记录 adSpends。
// 打开项目时把 adSpend 单值塌缩成一条记录、旧 expense 流水逐笔转成记录（保留日期/note），
// entries 只留 income。历史数据没有投放目标信息，统一按 engagement（互动）归类。
const migrateAdSpend = (p: Project): { adSpends: AdSpendRecord[]; entries: LedgerEntry[] } => {
  const records = [...(p.adSpends ?? [])]
  const single = cleanAmount(p.adSpend)
  if (single > 0) records.push({ id: genId('as'), goal: 'engagement', amount: single })
  for (const e of projectAdSpendEntries(p))
    records.push({ id: genId('as'), goal: 'engagement', amount: cleanAmount(e.amount), date: e.date, note: e.note })
  return {
    adSpends: records,
    entries: (p.entries ?? []).filter((e) => !isAdSpendEntry(e)),
  }
}

// Ad spend 追投输入：点 ⊕ 后展开——选投放目标（互动/粉丝/阅读量）+ 输入金额 → 新增一笔投放记录。
function BoostInput({
  currencySymbol,
  onCommit,
  onCancel,
}: {
  currencySymbol: string
  onCommit: (n: number, goal: AdSpendGoal) => void
  onCancel: () => void
}) {
  const [str, setStr] = useState('')
  const [goal, setGoal] = useState<AdSpendGoal>('engagement')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const submit = () => {
    const n = Number(str.trim().replace(/[,¥\s]/g, '')) || 0
    if (n <= 0) { onCancel(); return }
    onCommit(n, goal)
  }
  return (
    <div className="pd-boost-panel">
      <div className="td-chips expense pd-boost-goals" role="radiogroup" aria-label="Ad goal">
        {AD_SPEND_GOALS.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={goal === g}
            className={'td-chip' + (goal === g ? ' on' : '')}
            onClick={() => { haptic(8); setGoal(g); ref.current?.focus() }}
          >
            {AD_SPEND_GOAL_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="pd-boost-input">
        <span className="mi-sym">{currencySymbol}</span>
        <input
          ref={ref}
          inputMode="decimal"
          placeholder="Amount to add"
          value={str}
          onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setStr(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        />
        <button type="button" className="pd-boost-add" onClick={submit}>Add</button>
      </div>
    </div>
  )
}

// 金额输入：内部保留用户原始字符串，允许 "0." / "0.5" 等中间态，仅在变更时解析为数字。
// 修复受控 value=数字 把小数点/前导 0 当场吞掉、无法录入小数的问题。
// prefix/suffix 仅为展示装饰（¥ / % / +− 符号），不参与解析；money 开启失焦千分位。
function MoneyInput({
  value,
  onCommit,
  rate = false,
  money = false,
  prefix,
  suffix,
  className,
  inputClassName,
}: {
  value: number | undefined
  onCommit: (n: number) => void
  rate?: boolean
  money?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
  className?: string
  inputClassName?: string
}) {
  const displayFmt = (v: number | undefined) => (money && !rate ? fmtThousands(v) : fmtMoney(v))
  const [str, setStr] = useState(() => displayFmt(value))
  const focused = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // 外部值变化（加载/清空）时同步显示，但别在聚焦输入中途打断
    if (!focused.current) setStr(displayFmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <span className={'mi' + (prefix != null ? ' mi-hp' : '') + (suffix != null ? ' mi-hs' : '') + (className ? ' ' + className : '')}>
      {prefix != null && <span className="mi-sym mi-pre">{prefix}</span>}
      <input
        ref={inputRef}
        className={inputClassName}
        inputMode="decimal"
        placeholder="0"
        value={str}
        onFocus={() => {
          focused.current = true
          // 聚焦切回可编辑的裸数字（去掉千分位/符号），保证小数点、清空等可正常输入
          setStr(fmtMoney(value))
          // iOS 软键盘会盖住中下部的输入框：延迟到键盘弹起后滚入视野
          setTimeout(() => inputRef.current?.scrollIntoView({ block: 'center' }), 250)
        }}
        onBlur={() => {
          focused.current = false
          setStr(displayFmt(value))
        }}
        onChange={(e) => {
          const raw = e.target.value
          if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
          setStr(raw)
          const n = raw === '' || raw === '.' ? 0 : Number(raw)
          onCommit(rate ? cleanRate(n) : cleanAmount(n))
        }}
      />
      {suffix != null && <span className="mi-sym mi-suf">{suffix}</span>}
    </span>
  )
}

export default function ProjectDetail({ editor, onClose }: { editor: ProjectEditor; onClose: () => void }) {
  const currencySymbol = useCurrencySymbol()
  const editingId = editor.mode === 'edit' ? editor.id : null
  const isEditing = editingId !== null
  const existing = useLiveQuery<Project | undefined>(
    async () => (isEditing ? await db.projects.get(editingId) : undefined),
    [editingId],
  )

  const [form, setForm] = useState<Project>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [initial, setInitial] = useState<string | null>(null)
  const [dateTarget, setDateTarget] = useState<{ id: string; kind: 'entry' | 'spend' } | null>(null)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [entryCatOpenId, setEntryCatOpenId] = useState<string | null>(null)
  // 投放记录：目标 chips 展开中的记录 id（点类型标签切换 互动/粉丝/阅读量）
  const [spendGoalOpenId, setSpendGoalOpenId] = useState<string | null>(null)
  // Ad spend 追投：点 ⊕ 展开内联输入（目标 + 金额），提交后新增一笔投放记录
  const [boostOpen, setBoostOpen] = useState(false)
  // 乐观锁冲突时暂存待落库数据，交给 styled ConfirmDialog 回调决定是否覆盖
  const [conflictPayload, setConflictPayload] = useState<Project | null>(null)
  // 删除确认：点 Delete 不直接删，先弹确认框（Undo toast 只有几秒、易错过，home-bug-5）
  const [deleteOpen, setDeleteOpen] = useState(false)
  const savingRef = useRef(false)
  const loadedUpdatedAtRef = useRef<number | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const demoMode = new URLSearchParams(location.search).has('demo')
  const demoProject = isEditing && demoMode
    ? DEMO_PROJECTS.find((p) => p.id === editingId)
    : undefined

  useEffect(() => {
    if (editor.mode === 'new') {
      const next = { ...EMPTY, ...editor.prefill }
      // 预填数据若带旧 expense 流水，同样迁移进单值（一致性）
      const migrated = migrateAdSpend(next)
      const seed = {
        ...next,
        entries: migrated.entries,
        isCommercial: next.isCommercial ?? isCommercialProject(next),
        adQuote: next.adQuote ?? projectQuote(next),
        rebateRate: next.rebateRate ?? projectRebateRate(next),
        adSpend: 0, // 单值已迁入 adSpends 逐笔记录
        adSpends: migrated.adSpends,
        releaseDeadline: next.releaseDeadline ?? next.endDate ?? next.publishDate,
      }
      setForm(seed)
      setInitial(JSON.stringify(seed))
      setLoaded(true)
      // 空白新建预填集数：扫描现有最大 EP 编号 +1（数总数会因删除错号）。
      // 从选题转项目等带名字的 prefill 不强加前缀。
      if (!next.name) {
        void db.projects.toArray().then((all) => {
          let max = 0
          for (const p of all) {
            const m = /^EP\s*(\d+)/i.exec(p.name ?? '')
            if (m) max = Math.max(max, Number(m[1]))
          }
          const name = `EP${String(max + 1).padStart(3, '0')} · `
          setForm((f) => {
            if (f.name) return f
            const withName = { ...f, name }
            setInitial(JSON.stringify(withName))
            return withName
          })
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const source = existing ?? demoProject
    if (isEditing && source && !loaded) {
      // 一次性迁移：旧 adSpend 单值 / 旧 expense 流水 → adSpends 逐笔投放记录
      const migrated = migrateAdSpend(source)
      const seed = {
        ...source,
        releaseDeadline: source.releaseDeadline ?? source.endDate ?? source.publishDate,
        entries: migrated.entries,
        isCommercial: source.isCommercial ?? isCommercialProject(source),
        adQuote: source.adQuote ?? projectQuote(source),
        rebateRate: source.rebateRate ?? projectRebateRate(source),
        adSpend: 0, // 单值已迁入 adSpends 逐笔记录
        adSpends: migrated.adSpends,
      }
      setForm(seed)
      setInitial(JSON.stringify(seed))
      loadedUpdatedAtRef.current = source.updatedAt ?? null
      setLoaded(true)
    }
  }, [demoProject, existing, isEditing, loaded])

  const set = <K extends keyof Project>(k: K, v: Project[K]) => setForm((f) => ({ ...f, [k]: v }))

  /* ---- 收支明细（流水）：仅 income（ad spend 已上移为单值卡） ---- */
  const addEntry = (type: EntryType) => {
    haptic(8)
    const id = genId('e')
    setForm((f) => ({
      ...f,
      entries: [
        ...(f.entries ?? []),
        { id, type: 'income', category: type === 'income' ? '平台分成' : '投流/广告', amount: 0, date: todayKey() },
      ],
    }))
    setEntryCatOpenId(id)
  }
  // 追投：新增一笔投放记录（目标 + 金额，日期默认今天）
  const boost = (n: number, goal: AdSpendGoal) => {
    haptic(8)
    const rec: AdSpendRecord = { id: genId('as'), goal, amount: Math.max(0, n), date: todayKey() }
    setForm((f) => ({ ...f, adSpends: [...(f.adSpends ?? []), rec] }))
  }
  const updSpend = (id: string, patch: Partial<AdSpendRecord>) =>
    set('adSpends', (form.adSpends ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const delSpend = (id: string) => {
    haptic(8)
    set('adSpends', (form.adSpends ?? []).filter((r) => r.id !== id))
  }
  const updEntry = (id: string, patch: Partial<LedgerEntry>) =>
    set('entries', (form.entries ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const delEntry = (id: string) => {
    haptic(8)
    set('entries', (form.entries ?? []).filter((e) => e.id !== id))
  }

  const commercial = isCommercialProject(form)

  // 实际落库：乐观锁通过、或用户在确认卡里选择覆盖后执行
  const commit = async (payload: Project) => {
    if (savingRef.current) return // 防双击重复写
    savingRef.current = true
    try {
      if (isEditing && existing) await updateProject(editingId, payload)
      else if (isEditing) await createProject({ ...payload, id: editingId })
      else await createProject(payload)
      toast('Saved')
      onClose()
    } finally {
      savingRef.current = false
    }
  }

  const save = async () => {
    if (savingRef.current) return // 防双击重复创建
    // 编辑态数据未加载完别保存，否则会用空表单覆盖原记录
    if (isEditing && !loaded) return
    // 名称必填：空名拦截并聚焦标题（主按钮同时置灰提示）
    if (!form.name.trim()) {
      titleRef.current?.focus()
      toast('Name it first')
      return
    }
    // 发布日必填：无日期的项目在日历/月度归月里会「消失」找不到，强制填写（主按钮同时置灰）
    if (!form.releaseDeadline) {
      setReleaseOpen(true)
      toast('Set a publish date')
      return
    }
    // 演示模式（?demo）只读：新建项目 或 编辑演示项目都不写真库（!existing 同时覆盖这两种）
    if (demoMode && !existing) {
      toast('Demo mode — changes are not saved')
      onClose()
      return
    }
    // 发布日：来自表单的「发布日期」编辑（releaseDeadline 权威），下方镜像到 endDate/publishDate 保持月度归月一致
    const release = form.releaseDeadline
    // ad spend 现为逐笔记录 adSpends（旧单值/旧 expense 流水在加载时已一次性迁移），不再在此做迁移
    const payload: Project = {
      ...form,
      isCommercial: !!form.isCommercial,
      adQuote: cleanAmount(form.adQuote),
      rebateRate: cleanRate(form.rebateRate),
      adSpend: cleanAmount(form.adSpend),
      adSpends: (form.adSpends ?? []).map((r) => ({ ...r, amount: cleanAmount(r.amount) })),
      entries: form.entries ?? [],
      status: form.status,
      releaseDeadline: release,
      endDate: release,
      publishDate: release,
    }
    // 乐观锁：保存前比对版本，项目在别处被改过就弹 styled 确认卡，让用户确认是否覆盖
    if (isEditing && existing) {
      const fresh = await db.projects.get(editingId)
      if (
        fresh &&
        loadedUpdatedAtRef.current != null &&
        (fresh.updatedAt ?? 0) !== loadedUpdatedAtRef.current
      ) {
        setConflictPayload(payload) // 暂存待覆盖数据，落库交由 ConfirmDialog 回调
        return
      }
    }
    await commit(payload)
  }
  // 点 Delete → 弹确认框（不再直接删 + 仅靠 Undo toast 兜底，home-bug-5）
  const remove = () => {
    if (!isEditing) return
    setDeleteOpen(true)
  }
  // 确认删除：落库 + 关闭 + Undo toast（确认后的二次安全网）
  const confirmDelete = async () => {
    if (!isEditing) return
    setDeleteOpen(false)
    const snap = await deleteProject(editingId)
    onClose()
    toast('Deleted', { actionLabel: 'Undo', onAction: () => snap && void restoreProject(snap) })
  }

  // 双轴派生：生产阶段 stage（驱动段控件选中）+ 付款 paid（驱动 Paid 开关）。写库仍走底层枚举。
  const stage = stageOf(form.status)
  const paid = isPaid(form.status)
  const isPublished = stage === 'published'
  // 段切换：Planned→lead / Producing→confirmed / Published→保留原收款态（原本 settled 则续 settled，否则落 published 未收）
  const setStage = (st: ProjectStage) => {
    haptic(8)
    const next: ProjectStatus =
      st === 'planned'
        ? 'lead'
        : st === 'producing'
          ? 'confirmed'
          : form.status === 'settled'
            ? 'settled'
            : 'published'
    set('status', next)
  }
  // Paid 开关：开→settled（已收）/ 关→published（已发未收）
  const togglePaid = () => {
    haptic(8)
    set('status', form.status === 'settled' ? 'published' : 'settled')
  }

  return (
    <>
    <Sheet
      // 同一个表单：新建时中性 New content（入口只有一个，不预判商单/自制）；
      // 编辑时措辞随 Commercial 开关走：商单=Order / 自制=Post
      title={isEditing ? (commercial ? 'Edit order' : 'Edit post') : 'New content'}
      onClose={onClose}
      leftActionLabel="Cancel"
      primaryLabel={isEditing ? 'Save changes' : 'Create'}
      onPrimary={save}
      primaryDisabled={!form.name.trim() || !form.releaseDeadline}
      confirmOnClose={initial !== null && JSON.stringify(form) !== initial}
    >
      {isEditing && !loaded ? (
        // 编辑态首查未决：不渲染空白表单（否则用户手快打字会被 setForm(seed) 覆盖丢失，home-bug-2）。
        // 给骨架占位，加载完即替换为真实表单。
        <div className="pd-loading" aria-label="Loading">
          <span className="pd-loading-bar" />
        </div>
      ) : (
      <div className="pd">
        {/* 标题行：左侧可选 emoji 头像（点开快捷面板选/清），右侧订单名。头像同步到首页/日历订单卡。 */}
        <div className="pd-titlerow">
          <div className="pd-icon-wrap">
            <button
              type="button"
              className={'pd-icon' + (iconOpen ? ' open' : '')}
              onClick={() => setIconOpen((v) => !v)}
              aria-label="Choose cover icon"
              aria-expanded={iconOpen}
            >
              {form.icon ? (
                <span className="pd-icon-emoji">{form.icon}</span>
              ) : form.name.trim() ? (
                // 未选 emoji 但已有名字：预览首页实际会渲染的「身份色 + 首字母」头像
                // （avatarTone/avatarInitial 与 he-oi 同源，丨/｜/| 分隔符已在 avatar.ts 排除）
                (() => {
                  const tone = avatarTone(form.id || form.name)
                  return (
                    <span className="pd-icon-tone" style={{ background: tone.bg, color: tone.fg }}>
                      {avatarInitial(form.name)}
                    </span>
                  )
                })()
              ) : (
                <span className="pd-icon-add">
                  <SmileIcon />
                </span>
              )}
            </button>
            {iconOpen && (
              <>
                <div className="pd-stage-mask" onClick={() => setIconOpen(false)} />
                <div className="pd-icon-panel" role="listbox" aria-label="Cover icon">
                  {PROJECT_ICONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="option"
                      aria-selected={form.icon === e}
                      className={'pd-icon-opt' + (form.icon === e ? ' on' : '')}
                      onClick={() => {
                        haptic(8)
                        set('icon', e)
                        setIconOpen(false)
                      }}
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pd-icon-opt pd-icon-clear"
                    onClick={() => {
                      haptic(8)
                      set('icon', undefined)
                      setIconOpen(false)
                    }}
                  >
                    No icon
                  </button>
                </div>
              </>
            )}
          </div>
          <input
            ref={titleRef}
            className="pd-title"
            placeholder="Title or brand name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            onFocus={() => setTimeout(() => titleRef.current?.scrollIntoView({ block: 'center' }), 250)}
          />
        </div>

        {/* 财务条：项目=营收核心单元，顶部一眼看净额+毛利率（只读，随表单实时算；金额受隐藏金额控制） */}
        {/* 边界：老数据「非商单 + 仅残留旧 adSpend 字段、无流水」也有成本，同样要出 Net 条（纯展示） */}
        {(isCommercialProject(form) || (form.entries?.length ?? 0) > 0 || projectAdSpend(form) > 0) &&
          (() => {
            const income = projectIncome(form)
            const expense = projectExpense(form)
            const net = projectNet(form)
            const margin = income > 0 ? Math.round((net / income) * 100) : null
            return (
              <div className={'pd-finance-strip' + (net < 0 ? ' neg' : '')}>
                <div className="pfs-net">
                  <span className="pfs-label">Net</span>
                  <b>
                    <Money>{formatMoney(net)}</Money>
                  </b>
                  {margin !== null && <span className="pfs-margin">Margin {margin}%</span>}
                </div>
                <div className="pfs-sub">
                  <span>
                    Revenue <Money>{formatMoney(income)}</Money>
                  </span>
                  <span>
                    Cost <Money>{formatMoney(expense)}</Money>
                  </span>
                </div>
              </div>
            )
          })()}

        {/* ---------- Basics：Commercial 开关 + 双轴状态（Stage 段 + Published 时 Paid 开关）+ 发布日期 ---------- */}
        <section className="pd-card pd-row-card">
          <div className="pd-rows">
            <button
              type="button"
              className="pd-row"
              onClick={() => {
                haptic(8)
                set('isCommercial', !commercial)
              }}
            >
              <span className="pd-row-label">Commercial</span>
              <span className={commercial ? 'switch on' : 'switch'}>
                <i />
              </span>
            </button>

            {/* Stage 段控件（双轴·生产阶段）：三档写 lead/confirmed/published；Published 时旁边出 Paid 开关。
                标签「Stage」竖排在药丸上方一行（373dp 窄屏放不下同行会遮挡），药丸整宽三等分（见 .pd-stagebar CSS） */}
            <div className="pd-row pd-stagebar">
              <span className="pd-row-label">Stage</span>
              <span className="pd-seg" role="tablist" aria-label="Stage">
                {STAGE_TIERS.map((t) => {
                  const on = t.id === stage
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      className={'pd-seg-item st-' + t.id + (on ? ' on' : '')}
                      onClick={() => setStage(t.id)}
                    >
                      <i className="pd-seg-dot" style={{ background: t.color }} />
                      {t.label}
                    </button>
                  )
                })}
              </span>
            </div>

            {/* 收款轴：仅「商单 + Published」出现 Paid 开关（开→settled 已收 / 关→published 未收）。
                自制内容无回款轴，不显示 Paid。 */}
            {isPublished && commercial && (
              <button type="button" className="pd-row" onClick={togglePaid} aria-pressed={paid}>
                <span className="pd-row-label">
                  Paid
                  <span className={'pd-paid-tag ' + (paid ? 'paid' : 'unpaid')}>
                    <i className="pd-paid-dot" aria-hidden="true" />
                    {paid ? 'Received' : 'Awaiting'}
                  </span>
                </span>
                <span className={paid ? 'switch on' : 'switch'}>
                  <i />
                </span>
              </button>
            )}

            {/* 发布日期（必填）：月度统计/日历归月依据（releaseDeadline 权威，保存时镜像到 endDate/publishDate）。
                空日期的项目会在日历/月度里「消失」，故强制填写——未填时占位红字 Required 提示。 */}
            <button type="button" className="pd-row" onClick={() => setReleaseOpen(true)}>
              <span className="pd-row-label">Publish date</span>
              <span className="pd-row-val">
                {form.releaseDeadline ? (
                  prettyDate(form.releaseDeadline)
                ) : (
                  <span className="placeholder req">Required</span>
                )}
                <span className="pd-row-cal">
                  <CalIcon />
                </span>
              </span>
            </button>

            {/* 播放量（只读回显）：本 App 暂无采集入口，但迁移/导入/demo 数据可能带 views——
                有值才显示，让已有数据不再隐形（完整播放量分析看板见后续 Batch C）。 */}
            {typeof form.views === 'number' && form.views > 0 && (
              <div className="pd-row">
                <span className="pd-row-label">Views</span>
                <span className="pd-row-val">{form.views.toLocaleString('en-US')}</span>
              </div>
            )}
          </div>
        </section>

        {/* ---------- Finance：始终显示——护城河：任何项目（含非商单）都能记成本/投流；Commercial 开关只控 Quote/Rebate/Final income ---------- */}
        <section className="pd-card">
          <div className="pd-card-h">Finance</div>
          {commercial && (
            <>
              <div className="pd-fields">
                <label className="finance-field">
                  <span>Quote</span>
                  <MoneyInput value={form.adQuote} onCommit={(n) => set('adQuote', n)} money prefix={currencySymbol} />
                </label>
                <label className="finance-field">
                  <span>Rebate</span>
                  <MoneyInput value={form.rebateRate} rate onCommit={(n) => set('rebateRate', n)} suffix="%" />
                </label>
              </div>
              <div className="pd-profit">
                <span>Final income</span>
                <b className="pos"><Money>{formatMoney(projectAdIncome(form))}</Money></b>
              </div>
            </>
          )}

          {!commercial && projectAdSpend(form) === 0 && (form.entries ?? []).length === 0 && (
            <p className="pd-fin-hint">Log ad spend here — no need to switch on Commercial.</p>
          )}

          {/* Ad spend 总额卡（只读合计）：外面看总金额，逐笔历史在下方列表；⊕ 追投新增一笔投放记录 */}
          <div className="pd-adspend-row">
            <div className="finance-field readonly pd-adspend">
              <span>Ad spend · total</span>
              <b>
                <span className="mi-sym">{'−' + currencySymbol}</span>
                <Money bare>{formatMoney(projectAdSpend(form)).slice(1)}</Money>
              </b>
            </div>
            <button
              type="button"
              className="pd-boost"
              aria-label="Add ad spend record"
              onClick={() => { haptic(8); setBoostOpen((v) => !v) }}
            >
              +
            </button>
          </div>
          {boostOpen && (
            <BoostInput
              currencySymbol={currencySymbol}
              onCancel={() => setBoostOpen(false)}
              onCommit={(n, goal) => { boost(n, goal); setBoostOpen(false) }}
            />
          )}

          {/* 投放逐笔历史：每次投放一条记录（目标 / 金额 / 日期 / 备注），点目标标签切换 互动/粉丝/阅读量 */}
          {(form.adSpends ?? []).length > 0 && (
            <div className="pd-ledger pd-spend-history">
              {(form.adSpends ?? []).map((r) => (
                <div key={r.id} className="pd-entry expense">
                  <div className="pd-entry-top">
                    <button
                      type="button"
                      className="pd-entry-cat"
                      onClick={() => setSpendGoalOpenId((v) => (v === r.id ? null : r.id))}
                    >
                      <i className="pd-entry-dot" />
                      {AD_SPEND_GOAL_LABELS[r.goal] ?? r.goal}
                    </button>
                    <MoneyInput
                      className="pd-entry-amt exp"
                      value={r.amount}
                      onCommit={(n) => updSpend(r.id, { amount: n })}
                      money
                      prefix={'−' + currencySymbol}
                    />
                    <button className="td-del" onClick={() => delSpend(r.id)} aria-label="Delete ad spend record">
                      <XIcon />
                    </button>
                  </div>
                  {spendGoalOpenId === r.id && (
                    <div className="td-chips expense">
                      {AD_SPEND_GOALS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          className={'td-chip' + (r.goal === g ? ' on' : '')}
                          onClick={() => {
                            updSpend(r.id, { goal: g })
                            setSpendGoalOpenId(null)
                          }}
                        >
                          {AD_SPEND_GOAL_LABELS[g]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="pd-entry-sub">
                    <button type="button" className="td-when-btn" onClick={() => setDateTarget({ id: r.id, kind: 'spend' })}>
                      <CalIcon />
                      {r.date ? prettyDate(r.date) : 'Date'}
                    </button>
                    <input
                      className="pd-entry-note"
                      placeholder="Note"
                      value={r.note ?? ''}
                      onChange={(ev) => updSpend(r.id, { note: ev.target.value })}
                      onFocus={(ev) => setTimeout(() => ev.target.scrollIntoView({ block: 'center' }), 250)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pd-ledger">
            {(form.entries ?? []).filter((e) => e.type === 'income').map((e) => {
              const categoryLabel = e.category || '其他收入'
              return (
                <div key={e.id} className="pd-entry income">
                  <div className="pd-entry-top">
                    <button
                      type="button"
                      className="pd-entry-cat"
                      onClick={() => setEntryCatOpenId((v) => (v === e.id ? null : e.id))}
                    >
                      <i className="pd-entry-dot" />
                      {catLabel(categoryLabel)}
                    </button>
                    <MoneyInput
                      className="pd-entry-amt inc"
                      value={e.amount}
                      onCommit={(n) => updEntry(e.id, { amount: n })}
                      money
                      prefix={'+' + currencySymbol}
                    />
                    <button className="td-del" onClick={() => delEntry(e.id)} aria-label="Delete entry">
                      <XIcon />
                    </button>
                  </div>
                  {entryCatOpenId === e.id && (
                    <div className="td-chips income">
                      {INCOME_CATEGORIES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={'td-chip' + (categoryLabel === c ? ' on' : '')}
                          onClick={() => {
                            updEntry(e.id, { category: c })
                            setEntryCatOpenId(null)
                          }}
                        >
                          {catLabel(c)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="pd-entry-sub">
                    <button type="button" className="td-when-btn" onClick={() => setDateTarget({ id: e.id, kind: 'entry' })}>
                      <CalIcon />
                      {e.date ? prettyDate(e.date) : 'Date'}
                    </button>
                    <input
                      className="pd-entry-note"
                      placeholder="Note"
                      value={e.note ?? ''}
                      onChange={(ev) => updEntry(e.id, { note: ev.target.value })}
                      onFocus={(ev) => setTimeout(() => ev.target.scrollIntoView({ block: 'center' }), 250)}
                    />
                  </div>
                </div>
              )
            })}
            <div className="pd-ledger-actions">
              <button type="button" className="td-add" onClick={() => addEntry('income')}>
                + Income
              </button>
            </div>
            {(projectOtherIncome(form) > 0 || projectOtherExpense(form) > 0) && (
              <div className="pd-ledger-totals">
                {projectOtherIncome(form) > 0 && (
                  <span>
                    Other income <b className="pos"><Money>{formatMoney(projectOtherIncome(form))}</Money></b>
                  </span>
                )}
                {projectOtherExpense(form) > 0 && (
                  <span>
                    Other cost <b className="neg"><Money>{formatMoney(projectOtherExpense(form))}</Money></b>
                  </span>
                )}
              </div>
            )}
          </div>

        </section>

        {/* ---------- Review · 复盘（发布/结款后出现） ---------- */}
        {isPublished && (
          <section className="pd-card pd-review">
            <div className="pd-card-h">Review</div>
            <textarea
              className="summary-input"
              rows={3}
              placeholder="How it performed / what worked / what to improve next…"
              value={form.review ?? ''}
              onChange={(e) => set('review', e.target.value)}
              onFocus={(e) => {
                // 底部文本域聚焦时滚动入视，避免被 iOS 软键盘从底部顶上来盖住
                const el = e.currentTarget
                setTimeout(() => el.scrollIntoView({ block: 'center' }), 250)
              }}
            />
          </section>
        )}

        {isEditing && (
          <button className="danger pd-delete" onClick={remove}>
            Delete this order
          </button>
        )}
      </div>
      )}
    </Sheet>
    {dateTarget && (
      <DatePicker
        value={
          dateTarget.kind === 'spend'
            ? (form.adSpends ?? []).find((r) => r.id === dateTarget.id)?.date
            : (form.entries ?? []).find((e) => e.id === dateTarget.id)?.date
        }
        onPick={(k) =>
          dateTarget.kind === 'spend' ? updSpend(dateTarget.id, { date: k }) : updEntry(dateTarget.id, { date: k })
        }
        onClear={() =>
          dateTarget.kind === 'spend'
            ? updSpend(dateTarget.id, { date: undefined })
            : updEntry(dateTarget.id, { date: undefined })
        }
        onClose={() => setDateTarget(null)}
      />
    )}
    {releaseOpen && (
      <DatePicker
        value={form.releaseDeadline}
        onPick={(k) => set('releaseDeadline', k)}
        onClear={() => set('releaseDeadline', undefined)}
        onClose={() => setReleaseOpen(false)}
      />
    )}
    {conflictPayload && (
      <ConfirmDialog
        title="Overwrite newer changes?"
        message="This item was changed elsewhere. Overwrite with your current edits?"
        confirmLabel="Overwrite"
        cancelLabel="Cancel"
        onConfirm={() => {
          const payload = conflictPayload
          setConflictPayload(null)
          void commit(payload)
        }}
        onCancel={() => setConflictPayload(null)}
      />
    )}
    {deleteOpen && (
      <ConfirmDialog
        title="Delete this content?"
        message="This removes the project and all its entries. You can undo shortly after."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    )}
    </>
  )
}
