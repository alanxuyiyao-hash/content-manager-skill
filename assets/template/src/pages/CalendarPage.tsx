import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  startOfMonth,
  startOfWeek,
  addDays,
  addMonths,
  isSameMonth,
  format,
} from 'date-fns'
import { db } from '../db'
import type { Project, ProjectStage } from '../types'
import { PROJECT_STAGE_META, stageOf, isPaid } from '../types'
import { toKey, todayKey, fromKey } from '../lib/date'
import { useTodayKey } from '../hooks/useTodayKey'
import { useReschedule } from '../hooks/useReschedule'
import { isProjectOverdue, projectsInMonth, projectReleaseDay } from '../lib/projectSchedule'
import { formatMoney, isCommercialProject, projectIncome } from '../lib/money'
import { avatarTone, avatarInitial, projectShortName } from '../lib/avatar'
import { Money } from '../lib/privacy'
import { haptic } from '../lib/haptics'
import { CheckIcon } from '../components/AppHeader'
import SwipeRow from '../components/SwipeRow'
import IconPickSheet from '../components/IconPickSheet'
import EmptyState from '../components/EmptyState'
import { DEMO_PROJECTS } from '../lib/demo'
import { orderSwipeActions } from '../lib/orderSwipe'
import type { TabFocus } from '../App'

// 日历页：Tracck 式一整页大月历（逐月切换 + 发布点 + 选中日面板），
// 用全 App 的「立体感优雅英文」皮肤（.el-page token / Clash Display / 暖色状态盘）。
// 数据口径沿用现有：某天发布 = projectsPublishingOn（releaseDeadline??endDate??publishDate）。
// 只管内容/商单发布（个人事件已下线）。零改动 money.ts / db.ts / 计算逻辑。

const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// 顶部筛选（双轴模型的生产阶段轴，与首页一致）：过滤月历上显示哪些发布点。
// 三阶段 All / Planned / Producing / Published；Published 含 published|settled（收款降为行内标记）。
type Filter = 'all' | ProjectStage
const FILTERS: { id: Filter; label: string; match: (st: ProjectStage) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'planned', label: PROJECT_STAGE_META.planned.label, match: (st) => st === 'planned' },
  { id: 'producing', label: PROJECT_STAGE_META.producing.label, match: (st) => st === 'producing' },
  { id: 'published', label: PROJECT_STAGE_META.published.label, match: (st) => st === 'published' },
]

// 阶段胶囊配色（与首页订单卡一致，三档各自色）：Planned=stone('s') / Producing=amber('m') / Published=沉静绿灰('p')
const STAGE_TONE: Record<ProjectStage, 's' | 'm' | 'p'> = {
  planned: 's',
  producing: 'm',
  published: 'p',
}

// 阶段固定序（月历分段下划条用）：planned→producing→published
const STAGE_ORDER: ProjectStage[] = ['planned', 'producing', 'published']

// "+"：日面板建单圆钮（与全局 FAB 同款字形，小号）
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
// 漏斗小图标：标题右上角筛选圆钮（描边风，与 he-ib 图标同语言）
function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 5.5h15l-5.7 6.6v5.1l-3.6 1.9v-7z" />
    </svg>
  )
}
// 缩放切换图标：日历 glyph——月历 ⇄ 清单（激活态=list 视图，由按钮 .on 实心表达）
function CalendarGlyphIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  )
}

export default function CalendarPage({
  onOpen,
  onNew,
  onLogSpend,
  focus,
}: {
  onOpen: (id: string) => void
  onNew: (p?: Partial<Project>) => void
  onLogSpend?: (id: string) => void
  /** Home/Stats 的 Posts 卡跳转时的锚定：设为查看月；n 递增标识新一次跳转（本页 keep-alive 常驻） */
  focus?: TabFocus | null
}) {
  const liveProjects = useLiveQuery(() => db.projects.toArray(), [])
  const demoMode = new URLSearchParams(location.search).has('demo')
  // 加载期区分：liveProjects===undefined = IndexedDB 首查未决（冷启动），用骨架替代闪空态
  // （cal-bug-2，与 Home home-bug-1 同修法）。下游 useMemo 用 projects（[] 兜底），渲染层用 loading。
  const loading = !demoMode && liveProjects === undefined
  const projects: Project[] = demoMode ? DEMO_PROJECTS : (liveProjects ?? [])

  const today = useTodayKey()
  // 查看月：首挂时消费已有锚定；此后本页 keep-alive 常驻，再次跳转由下方 effect 按 focus.n 消费。
  // 选中日与 moveMonth 同规则——真实今天落在该月选今天，否则选该月 1 号
  const [cursor, setCursor] = useState<Date>(() =>
    focus ? fromKey(`${focus.month}-01`) : new Date(),
  )
  const [selected, setSelected] = useState<string>(() =>
    focus && !isSameMonth(fromKey(`${focus.month}-01`), new Date())
      ? `${focus.month}-01`
      : todayKey(),
  )
  const [filter, setFilter] = useState<Filter>('all')
  const [filterOpen, setFilterOpen] = useState(false) // 漏斗胶囊的弹出筛选菜单
  const [iconPickOpen, setIconPickOpen] = useState(false) // 「+」先弹封面选择（与全局 FAB 一致）
  // 左滑 Move 改期/排期：弹系统日期滚轮 → 写三字段镜像 + Undo（共享 hook，首页同款）
  const resched = useReschedule(demoMode, (next) => {
    // 改期后跟随跳到新月选中那天，立刻看到结果
    const d = fromKey(next)
    setDir(d < cursor ? -1 : 1)
    setCursor(d)
    setSelected(next)
  })
  // 视图：month=月历格子（扫节奏）⇄ list=按日期分组的只读清单（读排期，名字可读）。
  // 旧 expanded（高格子+emoji 名牌）已退役：43px 窄格塞不下名字，退化成首字母后辨识度为零。
  const [zoom, setZoom] = useState<'month' | 'expanded'>('month')
  const [dir, setDir] = useState(0) // 换月方向（换月滑入动画）

  // 消费新一次卡片跳转的锚定（seenFocus ref 挡重复消费与 StrictMode 双跑，同月二跳也触发）
  const seenFocus = useRef(focus?.n ?? 0)
  useEffect(() => {
    if (!focus || focus.n === seenFocus.current) return
    seenFocus.current = focus.n
    const first = fromKey(`${focus.month}-01`)
    setCursor(first)
    setSelected(isSameMonth(first, new Date()) ? todayKey() : `${focus.month}-01`)
    setDir(0) // 不带上一次翻月方向的滑入动画
  }, [focus])

  const activeFilter = FILTERS.find((f) => f.id === filter)!
  const matcher = activeFilter.match
  const filterLabel = activeFilter.label

  // 月历固定 6 周 = 42 格网格（含相邻月补格）：锁死行数，换月时月卡不再因 5/6 行切换而高度跳变、
  // 带动下方日面板上下弹（原来只补到 endOfWeek，会出 35 或 42 格两种高度）。
  const gridDays = useMemo(() => {
    const gs = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const out: Date[] = []
    for (let i = 0; i < 42; i++) out.push(addDays(gs, i))
    return out
  }, [cursor])

  // 发布日索引：按发布日一次性归桶（O(N)），替代每格 projectsPublishingOn 全表扫描。
  // 月视图 42 格原本 O(N×42) 每次渲染，改为 O(N) 建 map + O(1) 查表；只随 projects 变化重建。
  const releaseMap = useMemo(() => {
    const m = new Map<string, Project[]>()
    for (const p of projects) {
      const day = projectReleaseDay(p)
      if (!day) continue
      const arr = m.get(day)
      if (arr) arr.push(p)
      else m.set(day, [p])
    }
    return m
  }, [projects])
  const releasesOn = (key: string) => releaseMap.get(key) ?? []

  // 当月内容（不分日）：给漏斗弹出菜单项挂月内计数——翻月时"这月有没有货"先于空态可知
  const monthProjects = useMemo(
    () => projectsInMonth(projects, format(cursor, 'yyyy-MM')),
    [projects, cursor],
  )
  const filterCounts = useMemo(() => {
    const out = {} as Record<Filter, number>
    for (const f of FILTERS)
      out[f.id] = monthProjects.filter((p) => f.match(stageOf(p.status))).length
    return out
  }, [monthProjects])

  const moveMonth = (delta: number) => {
    haptic(8)
    const next = addMonths(cursor, delta)
    setDir(delta)
    setCursor(next)
    // 切月自动选中：真实"今天"落在新月→选今天；否则→选该月 1 号。
    // 下方选中日面板随之更新，不再停在旧月的某天。
    setSelected(isSameMonth(next, new Date()) ? todayKey() : toKey(startOfMonth(next)))
  }
  const pickDay = (key: string) => {
    haptic(8)
    // 点相邻月补格（dim）：翻到那个月并选中那天，而非停留在当前月却只换日面板内容（反直觉）。
    const d = fromKey(key)
    if (!isSameMonth(d, cursor)) {
      setDir(fromKey(key) < cursor ? -1 : 1)
      setCursor(d)
    }
    setSelected(key)
  }
  // 回真实「今天」所在月并选今天：翻离当月时点月份标题触发。
  const backToToday = () => {
    if (isSameMonth(cursor, new Date()) && selected === today) return
    haptic(8)
    setDir(0)
    setCursor(new Date())
    setSelected(today)
  }
  const isCurrentMonth = isSameMonth(cursor, new Date())
  const pickFilter = (f: Filter) => {
    haptic(8)
    setFilter(f)
  }
  const toggleZoom = () => {
    haptic(8)
    setZoom((z) => (z === 'month' ? 'expanded' : 'month'))
  }
  // 日面板 "+"：先弹封面选择（与全局 FAB 一致），选完/Skip 再进详情并预填所选日为发布日。
  const openNewOrder = () => {
    haptic(8)
    // 新单默认 planned；若当前在非 all 筛选下，切回 all，避免"加了却被筛掉、看不见"(Bug-2)
    if (filter !== 'all') setFilter('all')
    setIconPickOpen(true)
  }

  // 左右滑切换月份（横滑主导才触发；纵滑交给页面滚动）。
  // 横滑换月：实时跟随手指 + rubber-band 衰减，松手按阈值吸附（翻月或回弹）。
  // 若手势起点落在订单行(.swipe-row)上，交给该行的左滑托盘，绝不触发换月。
  const touch = useRef({ x: 0, y: 0, active: false, lock: 'none' as 'none' | 'h' | 'v' })
  const maskTouchX = useRef(0) // 筛选遮罩上的横滑起点（滑动即关菜单，ix-9）
  const SWIPE_THRESH = 48 // 松手翻月阈值（沿用）
  const rubber = (dx: number) => {
    // 柔性跟随：前 96px 1:1，超出按 0.35 衰减（越拉越重，iOS 手感）
    const soft = Math.sign(dx) * Math.min(Math.abs(dx), 96)
    const rest = Math.sign(dx) * Math.max(0, Math.abs(dx) - 96) * 0.35
    return soft + rest
  }
  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest?.('.swipe-row')) {
      touch.current.active = false
      return
    }
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, active: true, lock: 'none' }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current.active) return
    const t = e.touches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    // 方向锁定：首次明显位移即判定横/纵，之后不再翻（避免斜滑抖动）
    if (touch.current.lock === 'none' && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      touch.current.lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (touch.current.lock !== 'h') return // 纵滑交给页面滚动，不动 grid
    const el = e.currentTarget as HTMLElement
    el.style.transition = 'none'
    el.style.transform = `translateX(${rubber(dx)}px)`
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current.active) return
    const wasH = touch.current.lock === 'h'
    touch.current.active = false
    touch.current.lock = 'none'
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const el = e.currentTarget as HTMLElement
    // 回弹/滑出动画：交给 CSS transition（remount 时新元素无内联 style，自动干净）
    el.style.transition = 'transform 0.22s ease'
    if (wasH && Math.abs(dx) > SWIPE_THRESH) {
      // 超阈值：朝手势方向滑出，再翻月（新内容靠 cal-el-slide 入场动画接续）
      el.style.transform = `translateX(${Math.sign(dx) * 280}px)`
      moveMonth(dx < 0 ? 1 : -1)
    } else {
      // 未超阈值或非横滑：回弹归位
      el.style.transform = ''
    }
  }

  // 选中日的内容发布（跟随顶部筛选）
  const selReleases = releasesOn(selected).filter((p) => matcher(stageOf(p.status)))
  const selCount = selReleases.length
  // 日面板副行减噪：仅当当日商单(AD)与自然流(Own)混排时才逐条显示类型副行
  const selMixed =
    selReleases.some(isCommercialProject) && selReleases.some((p) => !isCommercialProject(p))

  const slideCls = dir > 0 ? ' cal-el-slide' : dir < 0 ? ' cal-el-slide rev' : ''

  // 商单发布订单卡（复用首页 he-row）——选中日面板与 Agenda 列表共用，保证一致。
  // showKind：是否显示 "Sponsored / Own" 类型副行。本 App 几乎条条是广告，
  // 逐条重复信息量低——仅在与自然流(Own)混排、需区分时才传 true。AD 角标始终保留（护城河）。
  const renderReleaseRow = (p: Project, showKind = true) => {
    const initial = avatarInitial(p.name)
    // 头像柔色底：与首页同工具；settled(已完成=安静) 去饱和回落暖灰。
    const tone = avatarTone(p.id || p.name || '') // 纯身份色，不随收款状态变
    // 逾期：Active 单发布日已过仍未发布/结算（纯展示判断，复用 projectSchedule）
    const overdue = isProjectOverdue(p, today)
    const actions = orderSwipeActions(p, demoMode, undefined, (pp) => onLogSpend?.(pp.id), resched.requestMove)
    const stage = stageOf(p.status)
    return (
      <SwipeRow key={'rel' + p.id} className="he-swipe" actions={actions}>
        <button
          type="button"
          className={'he-row' + (p.status === 'settled' ? ' settled' : '')}
          onClick={() => {
            haptic(8)
            onOpen(p.id)
          }}
        >
          <span
            className={'he-oi' + (p.icon ? ' emoji' : '')}
            style={p.icon ? undefined : { background: tone.bg, color: tone.fg }}
            aria-hidden="true"
          >
            {p.icon || initial}
          </span>
          <span className="he-mid">
            <span className="he-nm">
              <span className="he-nm-text">{projectShortName(p.name) || p.name || 'Untitled'}</span>
              {isCommercialProject(p) && <i className="he-ad">Ad</i>}
            </span>
            {(showKind || overdue) && (
              <span className="he-dt">
                {showKind && (isCommercialProject(p) ? 'Sponsored' : 'Own')}
                {overdue && <i className="he-overdue">Overdue</i>}
              </span>
            )}
          </span>
          <span className={'he-rt' + (isCommercialProject(p) ? '' : ' solo')}>
            {/* 金额口径与首页 he-row 一致：仅商单显收入；自制内容非赚钱单元不放金额
                （哪怕记了投流成本，避免负数像「亏损」误导），右列只留阶段胶囊居中。 */}
            {isCommercialProject(p) && (
              <span className="he-am">
                <Money>{formatMoney(projectIncome(p))}</Money>
              </span>
            )}
            {/* 三阶段胶囊（与首页一致）：settled 仍属于 Published；商单用 paydot 表示收款状态。 */}
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
  }

  return (
    <div className="cal-el el-page">
      {/* 顶部：月份标题 ‖ 漏斗 · 缩放。换月靠横滑；翻离当月时标题可点一键回当月。 */}
      <header className="he-top">
        <h1 className="he-month">
          {isCurrentMonth ? (
            <span className="he-mtext">
              {format(cursor, 'MMM')} <span className="he-year">{format(cursor, 'yyyy')}</span>
            </span>
          ) : (
            <button
              type="button"
              className="he-mtext he-month-back"
              onClick={backToToday}
              aria-label={`Back to today, ${format(new Date(), 'MMM d')}`}
            >
              {format(cursor, 'MMM')} <span className="he-year">{format(cursor, 'yyyy')}</span>
            </button>
          )}
        </h1>
        <div className="he-top-r">
          {/* 筛选（Tracck 式右上角圆钮）：点开锚定弹出菜单；非 All 时 ink 实心态一眼可知在筛 */}
          <div className="cal-el-fwrap">
            <button
              type="button"
              className={'he-ib' + (filter !== 'all' ? ' on' : '')}
              onClick={() => {
                haptic(8)
                setFilterOpen((v) => !v)
              }}
              aria-haspopup="listbox"
              aria-expanded={filterOpen}
              aria-label="Filter releases"
            >
              <FunnelIcon />
            </button>
            {filterOpen && (
              <>
                {/* 遮罩：点击关闭；在遮罩上做横滑（想切月）时也先把菜单关掉，
                    避免手势被全屏遮罩整个吞掉、显得没反应（ix-9） */}
                <div
                  className="pd-stage-mask"
                  onClick={() => setFilterOpen(false)}
                  onTouchStart={(e) => {
                    maskTouchX.current = e.touches[0].clientX
                  }}
                  onTouchEnd={(e) => {
                    if (Math.abs(e.changedTouches[0].clientX - maskTouchX.current) > 40)
                      setFilterOpen(false)
                  }}
                />
                <div
                  className="pd-stage-menu cal-el-fmenu"
                  role="listbox"
                  aria-label="Filter releases"
                >
                  {FILTERS.map((f) => {
                    const on = filter === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={'pd-stage-item' + (on ? ' on' : '')}
                        onClick={() => {
                          pickFilter(f.id)
                          setFilterOpen(false)
                        }}
                      >
                        <span className="pd-stage-item-label">{f.label}</span>
                        {filterCounts[f.id] > 0 && (
                          <span className="cal-el-fmenu-n">{filterCounts[f.id]}</span>
                        )}
                        {/* ✓ 占固定宽槽位（未选中时保留占位不显示）：让各行计数右缘成列，
                            不再被选中行的 ✓ 挤左 24px */}
                        <span className="pd-stage-check" aria-hidden={!on}>
                          {on && <CheckIcon />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          {/* 视图切换（Tracck 式右上角圆钮，日历 glyph；list 态 ink 实心 .on）。
              本页不放头像：漏斗+缩放已两件，再加头像会把月份标题挤成省略号
              （真机反馈）——Me 走 tab 栏即可，不强求与 Home/Stats 同构。 */}
          <button
            type="button"
            className={'he-ib' + (zoom === 'expanded' ? ' on' : '')}
            onClick={toggleZoom}
            aria-label={zoom === 'month' ? 'Expand calendar with project names' : 'Compact calendar'}
            aria-pressed={zoom === 'expanded'}
          >
            <CalendarGlyphIcon />
          </button>
        </div>
      </header>

      {loading ? (
        // 冷启动：IndexedDB 首查未决，显骨架替代空日历/空日面板（cal-bug-2，与 Home 同修法）
        <div className="cal-el-loading" aria-hidden="true">
          <span className="cal-el-loading-bar" />
        </div>
      ) : (
      <>
      {zoom === 'month' ? (
        /* 大月历浮卡：裸数字 + 数字正下方阶段分段下划条（去重阶段、固定序，最多 3 段）。
           旧 expanded（高格子+emoji 名牌）已退役：43px 窄格塞不下名字，退化成首字母辨识度为零。 */
        <div className="cal-el-card">
          {/* 星期标纯视觉引导：日期格 aria-label 已含完整日期语义，星期行对屏阅读器隐藏避免冗余朗读 */}
          <div className="cal-el-wk" role="row" aria-hidden="true">
            {WK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div
            className={'cal-el-grid' + slideCls}
            role="grid"
            aria-label={`${format(cursor, 'MMMM yyyy')} calendar`}
            key={format(cursor, 'yyyy-MM')}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {gridDays.map((d) => {
              const key = toKey(d)
              const inMonth = isSameMonth(d, cursor)
              const rels = inMonth ? releasesOn(key).filter((p) => matcher(stageOf(p.status))) : []
              const total = rels.length
              const hasOverdue = rels.some((p) => isProjectOverdue(p, today))
              const cls =
                'cal-el-cell' +
                (inMonth ? '' : ' dim') +
                (key === today ? ' today' : '') +
                (key === selected ? ' sel' : '')
              const aria =
                format(d, 'MMMM d') +
                (key === today ? ', today' : '') +
                (hasOverdue ? ', overdue' : '') +
                (total > 0 ? ` · ${total} ${total === 1 ? 'item' : 'items'}` : '')
              // numwrap 把条钉在数字底下且等宽（Clash 无 tabular figures，1/2 位数宽度都在变，
              // 固定 22px 左锚条永远对不齐数字——改成跟随数字实际宽度的真·下划线）。
              // 分段：逾期红段(od)置首——逾期最该处理，比阶段色更醒目（同 he-overdue 玫红语义）。
              // 阶段段只统计当天「非逾期」项：这样一天里既有逾期、又有在产/已发时，红段与阶段段并存，
              // 不再因为有一个逾期就把当天其它项的阶段色整片吞掉（信息无损）。
              const nonOverdue = hasOverdue ? rels.filter((p) => !isProjectOverdue(p, today)) : rels
              const segs: ('od' | ProjectStage)[] = (hasOverdue ? (['od'] as ('od' | ProjectStage)[]) : []).concat(
                STAGE_ORDER.filter((st) => nonOverdue.some((p) => stageOf(p.status) === st)),
              )
              return (
                <button
                  key={key}
                  className={cls}
                  role="gridcell"
                  aria-current={key === today ? 'date' : undefined}
                  onClick={() => pickDay(key)}
                  aria-label={aria}
                >
                  <span className="cal-el-numwrap">
                    <span className="cal-el-num">{format(d, 'd')}</span>
                    {segs.length > 0 && (
                      <span className="cal-el-bar">
                        {segs.map((st) => (
                          <i key={st} className={st === 'od' ? 'od' : STAGE_TONE[st as ProjectStage]} />
                        ))}
                      </span>
                    )}
                  </span>
                  {/* 选中日不再在格内塞 emoji 小牌（与下方日面板重复）——格子只做「选中强调」
                      （变深 + 固定变高），当天内容只在下方日面板出现（完整订单行 + 左滑操作）。 */}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        /* 展开态月历（Expand）：与紧凑态同一 42 格，但格子加高——有项目的日子在格内
           堆叠「项目名文字标签」（状态色左条 + 淡底 + 省略号，非 emoji），一眼看到本月
           哪天有什么项目。选中日仍深墨、驱动下方日面板；横滑翻月同款。 */
        <div className="cal-el-card">
          <div className="cal-el-wk" role="row" aria-hidden="true">
            {WK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div
            className={'cal-el-xgrid' + slideCls}
            role="grid"
            aria-label={`${format(cursor, 'MMMM yyyy')} calendar, expanded`}
            key={format(cursor, 'yyyy-MM')}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {gridDays.map((d) => {
              const key = toKey(d)
              const inMonth = isSameMonth(d, cursor)
              const rels = inMonth ? releasesOn(key).filter((p) => matcher(stageOf(p.status))) : []
              const total = rels.length
              const cls =
                'cal-el-xcell' +
                (inMonth ? '' : ' dim') +
                (key === today ? ' today' : '') +
                (key === selected ? ' sel' : '')
              const aria =
                format(d, 'MMMM d') +
                (key === today ? ', today' : '') +
                (total > 0 ? ` · ${total} ${total === 1 ? 'item' : 'items'}` : '')
              return (
                <button
                  key={key}
                  className={cls}
                  role="gridcell"
                  aria-current={key === today ? 'date' : undefined}
                  onClick={() => pickDay(key)}
                  aria-label={aria}
                >
                  <span className="cal-el-xnum">{format(d, 'd')}</span>
                  {/* 项目名标签：纯展示（最多 3 条，溢出折 +N）。整格点击=选中当天（不开弹窗，
                      避免点日期误触标签弹项目详情）；开详情走下方日面板的项目行。 */}
                  {rels.slice(0, 3).map((p) => {
                    const od = isProjectOverdue(p, today)
                    return (
                      <span
                        key={p.id}
                        className={'cal-el-lbl ' + (od ? 'od' : STAGE_TONE[stageOf(p.status)])}
                        aria-hidden="true"
                      >
                        {projectShortName(p.name) || p.name || 'Untitled'}
                      </span>
                    )
                  })}
                  {total > 3 && <span className="cal-el-xmore">+{total - 3}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 选中日面板：订单卡 + 事件 + 普通发布 */}
      <section className="cal-el-day">
        <div className="cal-el-day-h">
          <div className="cal-el-day-lead">
            <div className="cal-el-day-tw">
              <span className="cal-el-day-t">{format(fromKey(selected), 'EEE, MMM d')}</span>
              {selCount > 0 && (
                <span className="cal-el-day-sub">
                  {selCount === 1 ? '1 item' : `${selCount} items`}
                </span>
              )}
            </div>
          </div>
          {/* 圆形 "+"（40px）：本页唯一添加入口——新建内容并预填所选日为发布日（全局 FAB 在本页隐藏） */}
          <button
            className="cal-el-plus"
            onClick={openNewOrder}
            aria-label={`New content on ${format(fromKey(selected), 'MMM d')}`}
          >
            <PlusIcon />
          </button>
        </div>

        {selCount === 0 ? (
          /* 空态：复用全站 EmptyState（图标+提示+行动按钮），与 Home 空态对等。
             行动按钮预填所选日为发布日（与头部 "+" 同语义，给空日子一个明确出口） */
          <EmptyState
            title={filter === 'all' ? 'Nothing on this day' : 'Nothing in this filter'}
            hint={
              filter === 'all'
                ? 'Content scheduled for this day shows up here'
                : 'Try another filter, or add something new'
            }
            actionLabel="+ New content"
            onAction={openNewOrder}
          />
        ) : (
          <div className="cal-el-list">
            {/* 发布内容 —— 复用首页订单浮卡（renderReleaseRow）。
                副行 mixed 逻辑：全组同类时省掉重复的类型副行（AD 角标已表达）。 */}
            {selReleases.map((p) => renderReleaseRow(p, selMixed))}
          </div>
        )}
      </section>
      </>
      )}

      {/* 「+」新建首屏：先选封面（与全局 FAB 共用 IconPickSheet），选完带 icon + 所选日进详情 */}
      {iconPickOpen && (
        <IconPickSheet
          onPick={(icon) => {
            setIconPickOpen(false)
            onNew(icon ? { icon, publishDate: selected } : { publishDate: selected })
          }}
          onClose={() => setIconPickOpen(false)}
        />
      )}

      {/* 左滑 Move 改期：弹 App 自定义 DatePicker（与详情页选发布日同一套底部日历 UI） */}
      {resched.movePicker}
    </div>
  )
}
