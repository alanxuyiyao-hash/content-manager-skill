import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, addMonths } from 'date-fns'
import { db, getOverheads } from '../db'
import type { Overhead, Project, ProjectStage } from '../types'
import { PROJECT_STAGE_META, stageOf, isPaid } from '../types'
import { isProjectOverdue, projectReleaseDay, projectsInMonth } from '../lib/projectSchedule'
import { cadence as contentCadence } from '../lib/contentStats'
import {
  compactMoney,
  formatMoney,
  isCommercialProject,
  projectAdSpend,
  projectIncome,
  projectNet,
} from '../lib/money'
import { prettyDate } from '../lib/date'
import { useTodayKey } from '../hooks/useTodayKey'
import { useReschedule } from '../hooks/useReschedule'
import { avatarTone, avatarInitial, projectShortName } from '../lib/avatar'
import { Money, usePrivacy } from '../lib/privacy'
import { useCurrencySymbol } from '../lib/currency'
import { maybeNotifyOverdue, useReminders } from '../lib/reminders'
import EmptyState from '../components/EmptyState'
import { ChevronLeft, ChevronRight } from '../components/AppHeader'
import SwipeRow from '../components/SwipeRow'
import { DEMO_PROJECTS } from '../lib/demo'
import { toast } from '../components/Toast'
import { haptic } from '../lib/haptics'
import { orderSwipeActions } from '../lib/orderSwipe'
import type { TabFocus } from '../App'

// 首页（home tab）：Clash Display 优雅英文版商单台。
// 顶部可翻月标题 + 头像 → 该月 Income Hero 卡（强化 Net）→ 横向筛选 bar → 该月内容列表。
// 目的收敛为两件事：一眼看本月大致财务，看本月「已发布 / 待发布」的内容 list。
// 红线：money.ts 零改动，只做展示层映射 + 样式 + 文案 + 字体 + 震感。

// 筛选 bar（Tracck 式横向 pill，取代旧漏斗菜单 + 排序 + 范围切换）：
//   All / Planned / Producing / Published，按 stageOf(status) 在本月内过滤；
//   另有一枚条件出现的 Overdue chip（仅有逾期时），点它 → 跨月只看逾期单（复盘入口）。
// Published 同时含 published|settled（是否收款降为行内 paydot，不再单列 Settled chip）。
type Filter = 'all' | 'overdue' | ProjectStage

const FILTERS: {
  id: Exclude<Filter, 'overdue'>
  label: string
  match: (stage: ProjectStage) => boolean
}[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'planned', label: PROJECT_STAGE_META.planned.label, match: (st) => st === 'planned' },
  { id: 'producing', label: PROJECT_STAGE_META.producing.label, match: (st) => st === 'producing' },
  { id: 'published', label: PROJECT_STAGE_META.published.label, match: (st) => st === 'published' },
]

// 阶段胶囊配色（三档各自色，与 PROJECT_STAGE_META 对齐）：
// Planned=stone('s')、Producing=amber('m')、Published=沉静绿灰('p')。文案直接取 meta.label。
const STAGE_TONE: Record<ProjectStage, 's' | 'm' | 'p'> = {
  planned: 's',
  producing: 'm',
  published: 'p',
}

const sum = (list: Project[], f: (p: Project) => number) => list.reduce((s, p) => s + f(p), 0)
const gapText = (days: number | null): string => {
  if (days === null) return '—'
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`
}
const lastText = (days: number | null): string => {
  if (days === null) return '—'
  if (days === 0) return 'today'
  return `${days}d ago`
}

const CAD_START = 4
const CAD_SPAN = 92

// Income 卡大额：拆出货币符号前缀做小字号（保留 money.ts 输出与隐私遮罩；符号跟随所选货币）
function CardIncome({ value, hide }: { value: number; hide: boolean }) {
  const symbol = useCurrencySymbol()
  const s = hide ? '' : formatMoney(value) // e.g. "¥23,800" / "-¥1,200"
  const neg = !hide && s.startsWith('-')
  const body = hide ? '•••' : s.replace(/^-?¥/, '')
  // 按字符数静态分档（与 Stats hero heroSz 同款）：>=9→sz-s、>=6→sz-m。
  // 配合 CSS 的 clamp(vw) 收字号 + .he-card-v overflow:hidden 兜底，个人账目量级不会溢出——
  // 故退役原先的 useLayoutEffect 量测循环 + ResizeObserver（翻月/切隐私时反复 layout thrash 抖动的根源）。
  const sizeCls = hide ? '' : body.length >= 9 ? ' sz-s' : body.length >= 6 ? ' sz-m' : ''
  return (
    <span className={'he-card-v he-swap' + sizeCls}>
      {neg && <span className="he-card-cur">-</span>}
      <span className="he-card-cur">{symbol}</span>
      {body}
    </span>
  )
}

// 每行日期文案（预计/实际发布日）：按生产阶段给轻前缀，呼应样稿 "Due / Published / Not started"。
// 收款状态不进日期行（另由行内 • Paid / • Unpaid 标记表达）。
function rowDateLabel(p: Project): string {
  const day = projectReleaseDay(p)
  const d = day ? prettyDate(day) : ''
  const stage = stageOf(p.status)
  if (stage === 'published') return d ? `Published ${d}` : 'Published'
  if (!d) return stage === 'planned' ? 'Not started' : 'Unscheduled'
  return `Due ${d}` // planned / producing 有排期日 → 预计发布
}

export default function Projects({
  onOpen,
  onNew,
  onLogSpend,
  onOpenStats,
  onOpenCalendar,
  focus,
}: {
  onOpen: (id: string) => void
  onNew: (p?: Partial<Project>) => void
  onLogSpend?: (id: string) => void
  /** Income 卡点击 → 切到 Stats tab 并锚定当前查看月（'yyyy-MM'） */
  onOpenStats?: (monthKey: string) => void
  /** Posts 卡点击 → 切到 Calendar tab 并锚定当前查看月（发布语义 → 看哪天发了什么） */
  onOpenCalendar?: (monthKey: string) => void
  /** Stats Revenue 卡跳回来时的锚定：设为查看月；n 递增标识新一次跳转（本页 keep-alive 常驻） */
  focus?: TabFocus | null
}) {
  const liveProjects = useLiveQuery(() => db.projects.toArray(), [])
  const demoMode = new URLSearchParams(location.search).has('demo')
  // projects 为 undefined = IndexedDB 首查未决（冷启动）；用这个区分「加载中」与「真空」，
  // 避免有数据的用户每次冷启都闪一帧 Welcome 空态（home-bug-1）。
  // 下游 useMemo 用 list（[] 兜底，加载期跑空），渲染层用 loading 判断显骨架而非空态。
  const loading = !demoMode && liveProjects === undefined
  const projects: Project[] = demoMode ? DEMO_PROJECTS : (liveProjects ?? [])
  const liveOverheads = useLiveQuery(() => getOverheads(), [])
  const overheads = demoMode ? [] : (liveOverheads ?? [])
  const { hideMoney } = usePrivacy()
  const { remindersOn } = useReminders()
  const handleNew: (p?: Partial<Project>) => void = demoMode
    ? () => toast('Demo mode — changes are not saved')
    : onNew

  // 单一筛选态（横向 pill bar）：'all' | 'overdue' | 生产阶段。无排序/范围/搜索——列表恒按发布日升序。
  const [filter, setFilter] = useState<Filter>('all')
  // 结算爽点：记住刚被结算的订单 id，短暂给该行金额绿色脉冲 + 勾号 morph，~900ms 后清除。
  // 纯展示层：由 SwipeRow 的 Settle 动作成功后回调触发（见 orderSwipeActions 的 onSettled）。
  const [settledId, setSettledId] = useState<string | null>(null)
  const settleTimer = useRef<number | null>(null)
  const overdueChipRef = useRef<HTMLButtonElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)

  // 翻月：viewMonth = 正在看的月份键('yyyy-MM')，默认今天所在月；‹ › 可前后翻月看历史/未来。
  // 跨午夜自动刷新（复用 Calendar/Monthly 同款 hook）：PWA 停在首页过夜后，
  // 逾期判定 / 逾期横幅 / Overdue chip / 每日提醒不再停留在昨天。
  const today = useTodayKey()
  const currentMonthKey = today.slice(0, 7)
  // 左滑 Move 改期/排期：弹系统日期滚轮 → 写三字段镜像 + Undo（共享 hook，日历同款）。
  // 改期到别月时跟随切月，立刻看到结果。
  const resched = useReschedule(demoMode, (next) => setViewMonth(next.slice(0, 7)))
  // 查看月：首挂时消费已有锚定；此后本页 keep-alive 常驻，再次跳转由下方 effect 按 focus.n 消费
  //（seenFocus ref 挡住重复消费与 StrictMode 双跑，同月二跳也能触发）
  const [viewMonth, setViewMonth] = useState(focus?.month ?? currentMonthKey)
  const seenFocus = useRef(focus?.n ?? 0)
  useEffect(() => {
    if (!focus || focus.n === seenFocus.current) return
    seenFocus.current = focus.n
    setViewMonth(focus.month)
    setFilter('all') // 对齐旧重挂载行为：锚定月进来看该月列表，不停留在跨月 Overdue 筛选
  }, [focus])
  const viewDate = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    return new Date(y, m - 1, 1)
  }, [viewMonth])
  const monthName = format(viewDate, 'MMMM')
  const monthShort = format(viewDate, 'MMM') // 头行标题用缩写（全站头部一致），卡内/空态仍用全名
  const yearLabel = format(viewDate, 'yyyy')
  const isCurrentMonth = viewMonth === currentMonthKey
  // 所看月份的项目（以发布日归月，projectsInMonth）
  const monthProjects = useMemo(() => projectsInMonth(projects, viewMonth), [projects, viewMonth])
  const monthIncome = useMemo(() => sum(monthProjects, projectIncome), [monthProjects])
  const monthAdSpend = useMemo(() => sum(monthProjects, projectAdSpend), [monthProjects])
  const monthOverhead = useMemo(
    () => overheads.filter((o) => o.date?.startsWith(viewMonth)).reduce((s, o) => s + o.amount, 0),
    [overheads, viewMonth],
  )
  // Net：与 Data 页同口径 = sum(本月, projectNet) − 本月固定支出(overhead)
  const monthNet = useMemo(
    () => sum(monthProjects, projectNet) - monthOverhead,
    [monthProjects, monthOverhead],
  )
  // 本月发布数（纯展示聚合，不碰 money.ts）：内容统一后 AD/OWN 同源于 projects——
  //   planned = 本月归月的全部内容条数（计划几条，任意 status）
  //   已发布  = 本月 status 为 published/settled 的内容（实际发了几条）
  //   ad      = 已发中商单(Commercial)条数
  //   organic = 已发中自制(非 Commercial)条数
  //   total   = 已发条数（= ad + organic，无数据即 0，绝不 NaN）
  const postStats = useMemo(() => {
    const published = monthProjects.filter((p) => p.status === 'published' || p.status === 'settled')
    // Ads/Own 按本月「全部计划内容」(planned + published) 拆分，而非只算已发——
    // 让 Posts 卡看到「本月排了几条广告 / 几条自制」的内容管线（如 9 条=6 广告+3 自制，已发 2）。
    const ad = monthProjects.filter(isCommercialProject).length
    const organic = monthProjects.length - ad
    return { ad, organic, total: published.length, planned: monthProjects.length }
  }, [monthProjects])
  const cadenceStats = useMemo(() => contentCadence(projects, today), [projects, today])
  const cadenceRange = `${prettyDate(cadenceStats.startKey)} – ${prettyDate(cadenceStats.endKey)}`
  const cadencePlot = useMemo(() => {
    const leftForOffset = (offset: number): string =>
      `${
        CAD_START +
        (Math.min(Math.max(offset, 0), cadenceStats.windowDays - 1) / Math.max(1, cadenceStats.windowDays - 1)) *
          CAD_SPAN
      }%`
    const ticks = [
      { label: '30d ago', offset: 0, edge: 'start' },
      { label: 'Today', offset: cadenceStats.windowDays - 1, edge: 'end' },
    ]
    return {
      ticks: ticks.map((t) => ({ ...t, left: leftForOffset(t.offset) })),
      points: cadenceStats.days.map((d) => ({ ...d, left: leftForOffset(d.offset) })),
    }
  }, [cadenceStats])

  // 逾期商单（全量口径判断，复用 projectSchedule.isProjectOverdue；跨月、纯只读，不动数据/金额口径）
  const overdue = useMemo(() => projects.filter((p) => isProjectOverdue(p, today)), [projects, today])

  // 生效筛选：在 render 期派生——若停在 overdue 但逾期已清零，则视作 all。
  // 这样 rows/分区头/空态/chip 高亮全用 effFilter，从根上消掉「结算最后一单后闪一帧空 Overdue 态」。
  // （filter state 仍由下方 useEffect 兜底同步回 all，保持状态干净。）
  const effFilter: Filter = filter === 'overdue' && overdue.length === 0 ? 'all' : filter

  // 筛选条溢出边缘渐隐：按滚动位置给 .he-filters 切 fade-l/-r/-lr（能往哪滚就淡哪侧、滑到头撤掉）。
  // 373dp 窄外屏下默认 4 枚就会溢出，末胶囊柔和淡出提示可横滑，替代硬切。overdue.length 变化会增减
  // 第 5 枚 chip → scrollWidth 变，重跑刷新。
  useEffect(() => {
    const el = filtersRef.current
    if (!el) return
    const update = () => {
      const sl = el.scrollLeft > 1
      const sr = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      el.classList.toggle('fade-lr', sl && sr)
      el.classList.toggle('fade-l', sl && !sr)
      el.classList.toggle('fade-r', sr && !sl)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [effFilter, overdue.length])

  // 每个阶段筛选在本月内的计数（chip 上的小数字）
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of FILTERS)
      counts[f.id] = monthProjects.filter((p) => f.match(stageOf(p.status))).length
    return counts
  }, [monthProjects])

  // 列表数据源：
  //   overdue 态 → 跨月全量逾期单；其余 → 本月项目按阶段过滤。
  // 恒按发布日升序（未排期恒殿后，不受影响）——不再提供排序/范围/搜索。
  const rows = useMemo(() => {
    const stageMatch = FILTERS.find((f) => f.id === effFilter)?.match ?? (() => true)
    const base =
      effFilter === 'overdue' ? overdue : monthProjects.filter((p) => stageMatch(stageOf(p.status)))
    return [...base].sort((a, b) => {
      const da = projectReleaseDay(a)
      const db2 = projectReleaseDay(b)
      if (!da && !db2) return b.updatedAt - a.updatedAt
      if (!da) return 1
      if (!db2) return -1
      return da.localeCompare(db2) || b.updatedAt - a.updatedAt
    })
  }, [effFilter, overdue, monthProjects])

  const pickFilter = (f: Filter) => {
    if (f === filter) return // 点已选中的 chip 不重复触发（不震、不 set）
    haptic(8)
    setFilter(f)
  }
  const shiftMonth = (d: number) => {
    haptic(8)
    if (filter === 'overdue') setFilter('all') // 翻月始终意味着「看那个月」，自动退出跨月的 overdue 复盘态
    setViewMonth(format(addMonths(viewDate, d), 'yyyy-MM'))
  }
  // 一键回本月（与 Calendar 同款）：翻离当月后标题变可点，点它直接跳回今天所在月
  // （‹ › 箭头只逐月步进，回本月仍靠点标题）——同样自动退出跨月 overdue 态。
  const backToCurrentMonth = () => {
    haptic(8)
    if (filter === 'overdue') setFilter('all')
    setViewMonth(currentMonthKey)
  }
  // Hero 卡区横滑翻月（与 Calendar 同语言：实时跟随 + 松手吸附）。
  // 手势区限定在 he-cards（翻月最直观、数字会变）；列表区有 SwipeRow 左滑结算，不挂手势避免冲突。
  const touch = useRef({ x: 0, y: 0, active: false, lock: 'none' as 'none' | 'h' | 'v', moved: false })
  const rubber = (dx: number) => {
    const soft = Math.sign(dx) * Math.min(Math.abs(dx), 96)
    const rest = Math.sign(dx) * Math.max(0, Math.abs(dx) - 96) * 0.35
    return soft + rest
  }
  const onCardsTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, active: true, lock: 'none', moved: false }
  }
  const onCardsTouchMove = (e: React.TouchEvent) => {
    if (!touch.current.active) return
    const t = e.touches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    if (touch.current.lock === 'none' && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      touch.current.lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (touch.current.lock !== 'h') return
    touch.current.moved = true
    const el = e.currentTarget as HTMLElement
    el.style.transition = 'none'
    el.style.transform = `translateX(${rubber(dx)}px)`
  }
  const onCardsTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current.active) return
    const wasH = touch.current.lock === 'h'
    const moved = touch.current.moved
    touch.current.active = false
    touch.current.lock = 'none'
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const el = e.currentTarget as HTMLElement
    el.style.transition = 'transform 0.22s ease'
    if (wasH && Math.abs(dx) > 48) {
      // 翻月：直接回弹归位，换月过渡交给 .he-swap 淡切（Home 卡片无 key remount，不能靠它清 transform）
      el.style.transform = ''
      shiftMonth(dx < 0 ? 1 : -1)
    } else {
      el.style.transform = ''
    }
    // 横滑翻月时吞掉卡片 click（防止滑完误跳 Stats/Calendar）
    if (moved) {
      const swallow = (ev: Event) => {
        ev.preventDefault()
        ev.stopPropagation()
        el.removeEventListener('click', swallow, true)
      }
      el.addEventListener('click', swallow, true)
    }
  }
  const openProject = (id: string) => {
    haptic(8)
    onOpen(id)
  }
  // 结算成功回调：标记该行进入短暂的“刚结算”态，触发金额脉冲 + 勾号 morph（CSS 动画自带 900ms）
  const flashSettled = (id: string) => {
    setSettledId(id)
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => setSettledId(null), 900)
  }
  // 卸载时清掉悬挂的定时器，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    },
    [],
  )

  // 最紧急一单（发布日最早）——系统通知 body 指向它
  const topOverdue = useMemo(() => {
    if (overdue.length === 0) return null
    return [...overdue].sort((a, b) =>
      (projectReleaseDay(a) || '').localeCompare(projectReleaseDay(b) || ''),
    )[0]
  }, [overdue])

  // 打开即提醒：本次会话若有逾期单且开关开启且已授权，弹一条系统通知（否则静默降级，靠 Overdue chip）
  useEffect(() => {
    if (!topOverdue) return
    const day = projectReleaseDay(topOverdue)
    const name = projectShortName(topOverdue.name) || topOverdue.name || 'Untitled'
    const label = day ? `${name} · due ${prettyDate(day)}` : name
    maybeNotifyOverdue(remindersOn, overdue.length, label)
  }, [topOverdue, overdue.length, remindersOn])

  // 逾期清零时（例如在 Overdue 视图里把最后一单结算掉）自动退回 All，避免停在空的 Overdue 态
  useEffect(() => {
    if (filter === 'overdue' && overdue.length === 0) setFilter('all')
  }, [filter, overdue.length])

  // Overdue chip 在最右、默认在横向溢出区外。进入 overdue 态时把它滚进视野，
  // 保证「选中态可见」；离开时不强行复位（用户可能正手动横滑浏览筛选）。
  useEffect(() => {
    if (effFilter !== 'overdue') return
    const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    overdueChipRef.current?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: rm ? 'auto' : 'smooth',
    })
  }, [effFilter])

  return (
    <div className="page home-elegant">
      {/* 顶部：月份标题 + 右侧 ‹ › 翻月箭头（与 Stats 同款，翻月的显式入口）。hero 卡横滑仍可翻月；
          翻离当月时标题变可点、一键回本月。 */}
      <header className="he-top">
        <h1 className="he-month">
          {isCurrentMonth ? (
            <span className="he-mtext">
              {monthShort} <span className="he-year">{yearLabel}</span>
            </span>
          ) : (
            <button
              type="button"
              className="he-mtext he-month-back"
              onClick={backToCurrentMonth}
              aria-label={`Back to this month, ${format(new Date(), 'MMMM')}`}
            >
              {monthShort} <span className="he-year">{yearLabel}</span>
            </button>
          )}
        </h1>
        <div className="he-top-r">
          <span className="he-mnav-group">
            <button type="button" className="he-mnav" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft />
            </button>
            <button type="button" className="he-mnav" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight />
            </button>
          </span>
        </div>
      </header>

      {/* Hero：两张对称大卡（Income / Posts）——同一套结构网格：大数字 + 标签 + 底部两格(krow)，
          两卡的 krow 基线完全对齐（标签 uppercase + Clash Display 数字同字号）。
          Income：NET(绿净利) | AD(深酸绿广告费)；Posts：AD(广告条数) | OWN(自制条数)。
          key=viewMonth：翻月时重挂载 → 重放 .he-swap 淡切（~120ms）；同月内 re-render 不重放。 */}
      {/* 宽度不对称(1.35:1)：收入卡数字重(¥+千分位)天然吃宽，Posts 的个位数配窄卡——
          两卡"满度"接近，消除"大数撑满 vs 小数旁全空"的失衡；网格结构仍完全同构。
          标签口径统一为同级缩写：NET/AD SPEND(钱) 与 ADS/OWN(条数)。 */}
      <section
        className="he-cards"
        aria-label="This month at a glance"
        onTouchStart={onCardsTouchStart}
        onTouchMove={onCardsTouchMove}
        onTouchEnd={onCardsTouchEnd}
      >
        {/* 纯指标展示卡（不再点击跳转 Stats/Calendar——底部导航已可达，且避免与卡区横滑翻月手势打架）。 */}
        <div className="he-card wide">
          <CardIncome key={viewMonth} value={monthIncome} hide={hideMoney} />
          <div className="he-card-l">Revenue · {monthName}</div>
          {/* kcell 金额走紧凑写法(¥73.4k)：373dp 窄屏下每格仅 ~69px，全量金额必截断；
              口径与 Stats Finance 卡展示同组值的语言一致 */}
          <div className="he-krow">
            <div className="he-kcell">
              <div className="he-kt">Net</div>
              <div className={'he-kn g' + (monthNet < 0 ? ' neg' : '')}>
                <Money>{compactMoney(monthNet)}</Money>
              </div>
            </div>
            <div className="he-kcell">
              <div className="he-kt">Ad spend</div>
              <div className="he-kn a">
                <Money>{compactMoney(monthAdSpend)}</Money>
              </div>
            </div>
          </div>
        </div>
        <div className="he-card">
          {/* 已发 / 计划：大数=本月实际发布数，/后小字=本月归月的计划总数（3/5=计划5发了3） */}
          <div key={viewMonth} className="he-card-v he-swap">
            {postStats.total}
            <span className="he-card-den">/{postStats.planned}</span>
          </div>
          <div className="he-card-l">Posts · {monthName}</div>
          <div className="he-krow">
            <div className="he-kcell">
              <div className="he-kt">Ads</div>
              <div className="he-kn a">{postStats.ad}</div>
            </div>
            <div className="he-kcell">
              <div className="he-kt">Own</div>
              <div className="he-kn">{postStats.organic}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="he-cadence" aria-label="Publishing cadence">
        <div className="he-cad-head">
          <span className="he-cad-eyebrow">Cadence</span>
          <span className="he-cad-summary">
            <span className="he-cad-count" aria-label={`${cadenceStats.count} posts in the past 30 days`}>
              <b className="he-cad-count-n">{cadenceStats.count}</b>
              <em>posts · 30d</em>
            </span>
            <span className="he-cad-range">{cadenceRange}</span>
          </span>
        </div>
        <div className="he-cad-chart">
          <div
            className="he-cad-track"
            role="img"
            aria-label={`Publishing cadence. ${cadenceStats.count} posts in the past 30 days. Last published ${lastText(
              cadenceStats.lastGap,
            )}. Average gap ${gapText(
              cadenceStats.avgGap,
            )}. Longest gap ${gapText(cadenceStats.maxGap)}.`}
          >
            <span className="he-cad-base" aria-hidden="true" />
            {cadencePlot.points.length === 0 && <span className="he-cad-empty">No releases</span>}
            {cadencePlot.points.map((p) => (
              <span
                key={p.key}
                className={'he-cad-dot ' + (p.ads ? 'ads' : 'own')}
                style={{ left: p.left }}
                title={`${prettyDate(p.key)} · ${p.items
                  .map((it) => it.name || 'Untitled')
                  .join(', ')}`}
              />
            ))}
            {cadencePlot.ticks.map((t) => (
              <span
                key={t.label}
                className={'he-cad-tick ' + (t.edge ? `edge-${t.edge}` : '')}
                style={{ left: t.left }}
                aria-hidden="true"
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className="he-cad-foot">
          <span className="he-cad-metric">
            <em>Avg gap</em>
            <b>{gapText(cadenceStats.avgGap)}</b>
          </span>
          <span className="he-cad-metric">
            <em>Longest</em>
            <b>{gapText(cadenceStats.maxGap)}</b>
          </span>
          <span className="he-cad-metric">
            <em>Last</em>
            <b>{lastText(cadenceStats.lastGap)}</b>
          </span>
        </div>
      </section>

      {/* 筛选 bar（Tracck 式横向 pill）：All / 各阶段 [ / Overdue·N ]。常驻、可横滑、选中填黑。
          语义用一组 toggle 按钮（role=group + aria-pressed），不用 tablist/tab——本页无 tabpanel，
          tab 角色会对读屏做错误承诺；计数用 aria-label 承载完整语义，可视裸数字仅作装饰。 */}
      {projects.length > 0 && (
        <div ref={filtersRef} className="he-filters" role="group" aria-label="Filter content">
          {FILTERS.map((f) => {
            const on = effFilter === f.id
            const n = filterCounts[f.id]
            return (
              <Fragment key={f.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={n > 0 ? `${f.label}, ${n} this month` : f.label}
                  className={'he-chip' + (on ? ' on' : '')}
                  onClick={() => pickFilter(f.id)}
                >
                  {f.label}
                  {n > 0 && <span className="he-chip-n">{n}</span>}
                </button>
                {/* Overdue chip 紧跟 All（仅有逾期时）：逾期是要优先看到的告警，置于 All 之后即在
                    首屏可见，不再被推到滚动区外只剩行内小角标（home-1；旧「玫瑰横幅」已不存在）。 */}
                {f.id === 'all' && overdue.length > 0 && (
                  <button
                    ref={overdueChipRef}
                    type="button"
                    aria-pressed={effFilter === 'overdue'}
                    aria-label={`Overdue, ${overdue.length} ${overdue.length === 1 ? 'item' : 'items'} across all months`}
                    className={'he-chip od' + (effFilter === 'overdue' ? ' on' : '')}
                    onClick={() => pickFilter('overdue')}
                  >
                    Overdue
                    <span className="he-chip-n">{overdue.length}</span>
                  </button>
                )}
              </Fragment>
            )
          })}
        </div>
      )}

      {/* 分区头：仅 overdue 态显示（此时它界定了「跨月全量逾期」这一 chip 之外的新语境）；
          其余 all/各阶段态不渲染分区头，让 pill bar 直接接列表——计数已在 chip 上，避免重复。 */}
      {rows.length > 0 && effFilter === 'overdue' && (
        <div className="he-sec">
          <span className="he-sec-t">Overdue</span>
          <span className="he-sec-a">across all months</span>
        </div>
      )}

      {/* 内容列表（grouped 白卡 + 发丝线分行） */}
      {loading ? (
        // 冷启动：IndexedDB 首查未决。不显 Welcome 空态（那会误导有数据的用户以为库空了），
        // 给一枚轻量骨架占位，首查回来即替换（home-bug-1）。
        <div className="he-loading" aria-hidden="true">
          <span className="he-loading-bar" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            projects.length === 0
              ? 'Welcome'
              : effFilter === 'overdue'
                ? 'Nothing overdue'
                : effFilter !== 'all'
                  ? 'Nothing in this filter'
                  : isCurrentMonth
                    ? 'Nothing this month'
                    : `Nothing in ${monthName}`
          }
          hint={
            projects.length === 0
              ? 'Log your first order or piece of content — it shows up here'
              : effFilter === 'overdue'
                ? 'You’re all caught up'
                : effFilter !== 'all'
                  ? 'Try another filter, or add something new'
                  : isCurrentMonth
                    ? 'Content you log for this month shows up here'
                    : `Content scheduled for ${monthName} shows up here`
          }
          actionLabel={effFilter === 'overdue' ? undefined : '+ New content'}
          onAction={effFilter === 'overdue' ? undefined : () => handleNew()}
        />
      ) : (
        <div className="he-list">
          {rows.map((p) => {
            const income = projectIncome(p)
            const initial = avatarInitial(p.name)
            // 头像柔色底：按 id 稳定取一组暖色；settled(已完成=安静) 去饱和回落暖灰。
            const tone = avatarTone(p.id || p.name || '') // 纯身份色，不随收款状态变
            // 逾期：Active 单发布日已过仍未发布/结算（纯展示判断，复用 projectSchedule）
            const rowOverdue = isProjectOverdue(p, today)
            const actions = orderSwipeActions(p, demoMode, flashSettled, (pp) =>
              onLogSpend?.(pp.id), resched.requestMove,
            )
            // 该行是否处于「刚结算」的短暂爽点态（金额脉冲 + 勾号 morph）
            const justSettled = settledId === p.id
            const stage = stageOf(p.status)
            return (
              <SwipeRow key={p.id} className="he-swipe" actions={actions}>
                <button
                  type="button"
                  className={'he-row' + (p.status === 'settled' ? ' settled' : '')}
                  onClick={() => openProject(p.id)}
                >
                  <span
                    className={'he-oi' + (p.icon ? ' emoji' : '')}
                    style={p.icon ? undefined : { background: tone.bg, color: tone.fg }}
                    aria-hidden="true"
                  >
                    {p.icon || initial}
                    {justSettled && (
                      // 勾号 morph：绿圆覆在首字母上，描边勾划入（CSS 自带 draw + pop）
                      <span className="he-oi-check">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 12.5l4.2 4.2L19 7" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span className="he-mid">
                    <span className="he-nm">
                      <span className="he-nm-text">
                        {projectShortName(p.name) || p.name || 'Untitled'}
                      </span>
                      {isCommercialProject(p) && <i className="he-ad">Ad</i>}
                    </span>
                    <span className="he-dt">
                      {rowDateLabel(p)}
                      {rowOverdue && <i className="he-overdue">Overdue</i>}
                    </span>
                  </span>
                  <span className={'he-rt' + (isCommercialProject(p) ? '' : ' solo')}>
                    {/* 金额列：仅商单显示收入；自制内容非赚钱单元不放金额（哪怕记了投流成本，
                        避免负数像「亏损」误导），右列只留阶段胶囊居中。 */}
                    {isCommercialProject(p) && (
                      <span className={'he-am' + (justSettled ? ' flash' : '')}>
                        <Money>{formatMoney(income)}</Money>
                      </span>
                    )}
                    {/* 三阶段胶囊：settled 仍属于 Published；商单用小点区分已收款（绿）/未收款（玫红）。 */}
                    <span
                      className={
                        'he-stt ' +
                        STAGE_TONE[stage] +
                        (stage === 'published' && isCommercialProject(p) ? ' has-dot' : '')
                      }
                      aria-label={
                        stage === 'published' && isCommercialProject(p)
                          ? `Published · ${isPaid(p.status) ? 'paid' : 'unpaid'}`
                          : undefined
                      }
                    >
                      {stage === 'published' && isCommercialProject(p) && (
                        <i
                          className={'he-paydot ' + (isPaid(p.status) ? 'paid' : 'unpaid')}
                          aria-hidden="true"
                        />
                      )}
                      {PROJECT_STAGE_META[stage].label}
                    </span>
                  </span>
                </button>
              </SwipeRow>
            )
          })}
        </div>
      )}

      {/* 左滑 Move 改期：弹 App 自定义 DatePicker（与详情页选发布日同一套底部日历 UI） */}
      {resched.movePicker}
    </div>
  )
}
