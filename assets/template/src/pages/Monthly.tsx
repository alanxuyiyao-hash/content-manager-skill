import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addMonths, addYears, format, differenceInCalendarDays } from 'date-fns'
import {
  db,
  updateProject,
  getOverheads,
  createOverhead,
  updateOverhead,
  deleteOverhead,
  detectRecurringOverheads,
  type RecurringOverheadHint,
} from '../db'
import type { Project, Overhead } from '../types'
import { OVERHEAD_CATEGORIES, catLabel } from '../types'
import {
  compactMoneyRaw,
  formatMoney,
  isCommercialProject,
  projectAdSpend,
  projectIncome,
  projectHasFinancialActivity,
  projectNet,
  projectOtherExpense,
} from '../lib/money'
import { todayKey, fromKey, prettyDate } from '../lib/date'
import { avatarTone, avatarInitial, projectShortName } from '../lib/avatar'
import { useTodayKey } from '../hooks/useTodayKey'
import { projectReleaseDay } from '../lib/projectSchedule'
import { Money, usePrivacy } from '../lib/privacy'
import { useCurrencySymbol, useMoneyFmt } from '../lib/currency'
import { ChevronLeft, ChevronRight, ChevronDown, XIcon, CheckIcon } from '../components/AppHeader'
import Sheet from '../components/Sheet'
import { TrendChart } from '../components/TrendChart'
import DatePicker from '../components/DatePicker'
import { toast } from '../components/Toast'
import { DEMO_PROJECTS } from '../lib/demo'
import { haptic } from '../lib/haptics'
import type { TabFocus } from '../App'

type Scope = 'month' | 'year'
// 护城河瀑布条的一段：宽度 w / 起点 start 控制视觉条；pct 单独表示占 Revenue 比例。
type WfSeg = { key: string; label: string; value: number; cls: string; w: number; start: number; pct: number | null }
type OverheadDraft = { id: string | null; amount: string; category: string; date: string; note: string }

// 只保留 Month / Year 两档时间窗——All(生涯累计)不驱动决策、且「我的」页已有 Net·all-time，删之。
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

const sum = <T,>(list: T[], f: (item: T) => number) => list.reduce((s, item) => s + f(item), 0)
const projectDataDay = (p: Project): string | undefined => projectReleaseDay(p)
const isInRange = (date: string | undefined, scope: Scope, monthKey: string, yearKey: string): boolean =>
  !!date && (scope === 'month' ? date.startsWith(monthKey) : date.startsWith(yearKey))
const pad2 = (n: number) => String(n).padStart(2, '0')

// 紧凑金额已上移 money.ts（Home Income 卡也要用）：组件内用当前 currencySymbol
// 绑定出同名 compactMoney（见下方组件体），故组件内所有调用点无需改动。
// compactAmount：纯数值（无货币符号），供热力图格等只需数字处——与符号无关
const compactAmount = (n: number): string => compactMoneyRaw(n, '')

// 窄屏(≈373dp 安卓)防截断：stat 瓷砖内宽 ≈137px，Clash Display 26px 数字 ≈14-15px/位——
// 正文(去符号) ≤7 字符（如 "999,999"）稳妥放得下；≥8 字符（带小数的大额、七位数）会顶边截断，
// 降级为紧凑写法(¥401.3k)。输出仍以 ¥ 开头，由外层 <Money> 统一换当前货币符号。
const tileMoney = (n: number): string => {
  const full = formatMoney(n)
  return full.replace(/^-?¥/, '').length >= 8 ? compactMoneyRaw(n, '¥') : full
}

// hero 大数分档降字号（Home CardIncome 同款阈值）：tileMoney 已把 ≥8 字符压成紧凑写法，
// 静态分档即可兜住，无需 CardIncome 的 ResizeObserver 量测
const heroSz = (n: number): string => {
  const len = tileMoney(n).replace(/^-?¥/, '').length
  return len >= 9 ? ' sz-s' : len >= 6 ? ' sz-m' : ''
}


// 应收账龄（展示层）：已交付未回款单距发布日的天数。today 由调用方传入，纯字符串键 + fromKey/date-fns，
// 不碰任何金额口径。逾期(发布日 < 今天) → 玫红高亮；发布当天 = Published today；发布日在未来(少见) = Due in Xd。
function recvAging(day: string | undefined, today: string): { text: string; overdue: boolean } {
  if (!day) return { text: 'Unscheduled', overdue: false }
  const d = differenceInCalendarDays(fromKey(today), fromKey(day))
  if (d > 0) return { text: `${d}d overdue`, overdue: true }
  if (d === 0) return { text: 'Published today', overdue: false }
  return { text: `Due in ${-d}d`, overdue: false }
}

// 周期性开销建议的去重 key（同名 + 同额 + 建议月份）：本次会话「×」忽略用
const recurHintKey = (h: RecurringOverheadHint): string => JSON.stringify([h.category, h.amount, h.nextMonthKey])

export default function Monthly({
  onOpen,
  onNew,
  focus,
  onOpenOrders,
  onOpenInsights,
}: {
  onOpen: (id: string) => void
  onNew: (p?: Partial<Project>) => void
  /** 首页 Income 卡跳转时的锚定：设为查看月并落月视图；n 递增标识新一次跳转（本页 keep-alive 常驻） */
  focus?: TabFocus | null
  /** Revenue 卡点击 → 切回 Home tab 并锚定当前查看月（'yyyy-MM'），看该月订单列表（仅月视图） */
  onOpenOrders?: (monthKey: string) => void
  /** Posts 卡点击 → 切到 Insights tab 并锚定当前查看月（「发了几条」的追问是「表现如何」，仅月视图） */
  onOpenInsights?: (monthKey: string) => void
}) {
  const liveProjects = useLiveQuery(() => db.projects.toArray(), [], [] as Project[])
  const demoMode = new URLSearchParams(location.search).has('demo')
  const projects = demoMode ? DEMO_PROJECTS : liveProjects
  // 固定支出（不挂项目）：demo 模式不读库
  const liveOverheads = useLiveQuery(() => getOverheads(), [], [] as Overhead[])
  const overheads = demoMode ? [] : liveOverheads
  // 查看月：首挂时消费已有锚定；此后本页 keep-alive 常驻，再次跳转由下方 effect 按 focus.n 消费
  const [cursor, setCursor] = useState<Date>(() => (focus ? fromKey(`${focus.month}-01`) : new Date()))
  const [scope, setScope] = useState<Scope>('month')
  const [scopeMenu, setScopeMenu] = useState(false) // 头行右上 Month/Year 下拉筛选的开合
  // 消费新一次卡片跳转的锚定（seenFocus ref 挡重复消费与 StrictMode 双跑，同月二跳也触发）
  const seenFocus = useRef(focus?.n ?? 0)
  useEffect(() => {
    if (!focus || focus.n === seenFocus.current) return
    seenFocus.current = focus.n
    setCursor(fromKey(`${focus.month}-01`))
    setScope('month') // 停在年视图时跳进来必须落月视图（旧靠重挂载的默认值实现）
  }, [focus])
  // 护城河瀑布条：当前 tap 弹 popover 的段 key（null=无）
  const [wfPop, setWfPop] = useState<string | null>(null)
  // 趋势线触屏 scrub：当前游标锚定的月份下标（null=无，桌面 hover 复用同一读数）
  const [trendIdx, setTrendIdx] = useState<number | null>(null)
  // 固定支出卡：默认折叠，仅展开时渲染明细列表与新增
  const [ohExpanded, setOhExpanded] = useState(false)
  // Receivables / Ad spend 卡默认折叠（与 Overheads 卡同款收起，缩短页面）：只显示卡头小结，点开看明细
  const [recvExpanded, setRecvExpanded] = useState(false)
  const [adPerfExpanded, setAdPerfExpanded] = useState(false)
  const { hideMoney } = usePrivacy()
  const fmtMoney = useMoneyFmt()
  const currencySymbol = useCurrencySymbol()
  // 紧凑金额随当前货币符号（修「切币种后 Stats 页紧凑数字仍显 ¥」）：绑定当前符号，下方 JSX 调用点不变
  const compactMoney = (n: number): string => compactMoneyRaw(n, currencySymbol)
  // 并排 KPI 网格（Efficiency 格）：k 档强制 1 位小数（¥8.0k 而非 ¥8k），
  // 让相邻格小数点对齐、不再 ¥8k / ¥57.2k 参差（真机反馈）。非 k 档沿用 compactMoney。
  const kMoney = (n: number): string => {
    const abs = Math.abs(n)
    if (abs >= 1000 && abs < 1000000) return `${n < 0 ? '-' : ''}${currencySymbol}${(abs / 1000).toFixed(1)}k`
    return compactMoney(n)
  }
  // 隐藏金额时连 aria-label 也遮住，否则 VoiceOver 会念出真实金额、DOM 也能看到（符号跟随所选货币）
  const moneyLabel = (n: number): string => (hideMoney ? `${currencySymbol}•••` : fmtMoney(n))
  // 固定支出录入（不挂项目）：null=新建，否则编辑该条
  const [ohOpen, setOhOpen] = useState(false)
  const [ohId, setOhId] = useState<string | null>(null)
  const [ohAmount, setOhAmount] = useState('')
  const [ohCat, setOhCat] = useState<string>(OVERHEAD_CATEGORIES[0])
  const [ohDate, setOhDate] = useState<string>(() => todayKey())
  const [ohNote, setOhNote] = useState('')
  const [ohInitial, setOhInitial] = useState<OverheadDraft | null>(null)
  const [ohDateOpen, setOhDateOpen] = useState(false)
  // 周期性开销提示：本次会话里被「×」忽略的建议 key（不持久化，刷新后可再提示）
  const [dismissedRecur, setDismissedRecur] = useState<Set<string>>(() => new Set())
  const today = useTodayKey()

  const year = cursor.getFullYear()
  const month = cursor.getMonth() + 1
  const yearKey = String(year)
  const monthKey = `${yearKey}-${pad2(month)}`
  const closeOverhead = () => {
    setOhOpen(false)
    setOhInitial(null)
    setOhDateOpen(false)
  }
  const ohDirty =
    ohInitial !== null &&
    (ohId !== ohInitial.id ||
      ohAmount !== ohInitial.amount ||
      ohCat !== ohInitial.category ||
      ohDate !== ohInitial.date ||
      ohNote !== ohInitial.note)

  const rangeProjects = useMemo(
    () => projects.filter((p) => isInRange(projectDataDay(p), scope, monthKey, yearKey)),
    [monthKey, projects, scope, yearKey],
  )

  // 不挂项目的固定支出：按 date 归到当前范围，和项目支出一起进 Cost / Net
  const rangeOverheads = useMemo(
    () => overheads.filter((o) => isInRange(o.date, scope, monthKey, yearKey)),
    [monthKey, overheads, scope, yearKey],
  )
  // 某月/某年的固定支出合计（key 为 yyyy-MM 或 yyyy 前缀）：供环比 / 趋势 / 年度净利扣减
  const overheadByKey = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of overheads) {
      const m = o.date.slice(0, 7)
      const y = o.date.slice(0, 4)
      map.set(m, (map.get(m) ?? 0) + o.amount)
      map.set(y, (map.get(y) ?? 0) + o.amount)
    }
    return map
  }, [overheads])
  const overheadAt = (key: string) => overheadByKey.get(key) ?? 0

  const income = sum(rangeProjects, projectIncome)
  const adSpend = sum(rangeProjects, projectAdSpend)
  // 成本三拆：投流(adSpend) + 项目内其他支出(otherExpense) + 不挂项目的固定支出(overheadCost)
  const otherExpense = sum(rangeProjects, projectOtherExpense)
  const overheadCost = sum(rangeOverheads, (o) => o.amount)
  const cost = adSpend + otherExpense + overheadCost
  const profit = sum(rangeProjects, projectNet) - overheadCost
  // 商单卡（Ad deals）数据：本范围内的商单条数 / 每单均收 / 每单均投 / 占全部内容比例（环填充用）。
  //   每单均收 = 商单收入 ÷ 商单条数（接单均价，报价锚点）
  //   每单均投 = 商单投流 ÷ 商单条数——只累加商单自己的投流，自制内容的投流不摊进来
  //     （adOrders 已只含商单，sum 只取它们的 projectAdSpend，天然排除自制内容）
  const adOrders = rangeProjects.filter(isCommercialProject)
  const adIncomeTotal = sum(adOrders, projectIncome) // 商单总收入（只作均值分子，不上卡——与 hero Revenue 恒等重复）
  const avgAdIncome = adOrders.length > 0 ? adIncomeTotal / adOrders.length : null
  // ROAS 护城河指标：商单收入 ÷ 商单投流（"每投 1 元带回多少收入"）。
  // 仅算商单——自制内容无回款收入，把它混进分子会让 ROAS 失去"投放回报"的语义。
  // 分母 = 商单自己的投流（adOrders 只含商单）；无商单投流 → null（hero ROAS 格缺席）。
  const adSpendTotal = sum(adOrders, projectAdSpend)
  const roas = adSpendTotal > 0 ? adIncomeTotal / adSpendTotal : null
  const avgAdSpend = adOrders.length > 0 ? sum(adOrders, projectAdSpend) / adOrders.length : null
  // 每单净赚 = 均收 − 均投（报价决策的落点数）：Ad deals 卡右侧第三行
  const avgAdNet = avgAdIncome !== null && avgAdSpend !== null ? avgAdIncome - avgAdSpend : null
  const adShare = rangeProjects.length > 0 ? adOrders.length / rangeProjects.length : 0
  // krow 三格并排空间紧：金额正文（去¥）封顶 5 字符，既保精度又不溢出。
  //   <1000         → compactMoney（¥0/¥560 本就短）
  //   [1000,1万)    → 保留一位小数 ¥3.5k（=5 字符，放得下，且与 Finance 卡读数一致）
  //   [1万,100万)   → 去小数 ¥12k/¥348k/¥871k（≤5 字符，避免 ¥98.8k 这种 6 字符溢出）
  //   ≥100万        → compactMoney 的 ¥8.8m 短形
  // 修 stats-1：原来 <10万 走 compactMoney 保留小数（¥98.8k=6字符），十万级净利+万级均价的
  // 普通月三格会齐溢出省略号；现在只在真正会超宽的 ≥1万 区间去小数。
  const krowMoney = (n: number): string => {
    const abs = Math.abs(n)
    const sign = n < 0 ? '-' : ''
    if (abs >= 1000 && abs < 10000) return `${sign}¥${(abs / 1000).toFixed(1)}k`
    if (abs >= 10000 && abs < 999500) return `${sign}¥${Math.round(abs / 1000)}k`
    return compactMoney(n)
  }
  const otherCost = otherExpense + overheadCost

  // 净额瀑布条（借鉴 Stripe）：从「到手 Revenue」起算 —— Revenue → −Ad → −Costs → Net，
  // 每段宽度按占 Revenue 比例（income 已扣平台返点，故不再显示 Gross/Platform，和顶部 Revenue 卡对齐）。
  // 数值全部复用上面既有量，绝不改 money.ts。亏损时 Net 段省略，分母退化为总支出，让成本段填满整条。
  const wfDenom = (profit >= 0 ? income : adSpend + otherCost) || 1
  const wfBase = [
    adSpend > 0 && { key: 'ad', label: 'Ad spend', value: adSpend, cls: 'wf-ad' },
    otherCost > 0 && { key: 'cost', label: 'Costs', value: otherCost, cls: 'wf-cost' },
    profit > 0 && { key: 'net', label: 'Net', value: profit, cls: 'wf-net' },
  ].filter(Boolean) as { key: string; label: string; value: number; cls: string }[]
  let wfAcc = 0
  const wfSegs: WfSeg[] = wfBase.map((s) => {
    const w = (s.value / wfDenom) * 100
    const seg: WfSeg = { ...s, w, start: wfAcc, pct: income > 0 ? Math.round((s.value / income) * 100) : null }
    wfAcc += w
    return seg
  })
  const wfActive = wfSegs.find((s) => s.key === wfPop) ?? null

  // 单项目投流拆解（Ad spend）：本月有投流的内容逐条拆解，只回答「投了多少钱、投到哪类内容」。
  // 广告笔记的收入/每单质量交给 Ad deals；自制内容也可能投流，所以这里不再判断赚没赚回、也不显示 ROAS。
  const adPerf = useMemo(() => {
    const rows = rangeProjects
      .map((p) => ({ p, spend: projectAdSpend(p), sponsored: isCommercialProject(p) }))
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend)
    const totalSpend = sum(rows, (r) => r.spend)
    const sponsoredSpend = sum(rows.filter((r) => r.sponsored), (r) => r.spend)
    const ownSpend = totalSpend - sponsoredSpend
    const denom = Math.max(1, ...rows.map((r) => r.spend))
    return { shown: rows, totalSpend, sponsoredSpend, ownSpend, denom }
  }, [rangeProjects])

  const rangeLabel = scope === 'month' ? format(cursor, 'MMMM yyyy') : String(year)

  // 近 6 月净利趋势（固定滚动窗口，锚定当前真实月份，与所选月份无关；几何在此算好供 SVG 直接用）
  const trend6 = useMemo(() => {
    const base = new Date()
    const months = Array.from({ length: 6 }, (_, k) => {
      const d = addMonths(base, k - 5)
      const key = format(d, 'yyyy-MM')
      const list = projects.filter((p) => projectDataDay(p)?.startsWith(key))
      return { key, label: format(d, 'MMM'), net: sum(list, projectNet) - overheadAt(key) }
    })
    const vals = months.map((m) => m.net)
    // 个人基线（借鉴 WHOOP typical range）：过去 12 个完整月里「有数据的月份」净利的 25-75 分位。
    // 与自己比而非比绝对值/环比——落在带内=正常节奏，跳出带=好/坏月一眼可辨。
    // 完整月才进样本（当月进行中不算）；不足 3 个有数据月 → 不画带不判定（样本太少不可信）。
    const histNets: number[] = []
    for (let k = 1; k <= 12; k++) {
      const key = format(addMonths(base, -k), 'yyyy-MM')
      const list = projects.filter((p) => projectDataDay(p)?.startsWith(key))
      // 样本月=有钱进出的月（任一项目有收入/支出，或有固定支出）——只有 lead 想法、没有任何
      // 金额的月不算"经营过的月"，否则一条旧灵感就把 ¥0 掺进基线把带拖垮
      const moved = list.some(projectHasFinancialActivity) || overheadAt(key) !== 0
      if (!moved) continue
      histNets.push(sum(list, projectNet) - overheadAt(key))
    }
    const pct = (sorted: number[], q: number): number => {
      const pos = (sorted.length - 1) * q
      const lo = Math.floor(pos)
      const hi = Math.ceil(pos)
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
    }
    const histSorted = [...histNets].sort((a, b) => a - b)
    const range = histSorted.length >= 3 ? { lo: pct(histSorted, 0.25), hi: pct(histSorted, 0.75) } : null
    // y 轴定标把带的上下界也纳入：带永远真实入画，不被 6 个可见值的范围裁掉
    const maxV = Math.max(...vals, 0, range ? range.hi : 0)
    const minV = Math.min(...vals, 0, range ? range.lo : 0)
    const span = maxV - minV || 1
    const W = 320
    const H = 88
    const padX = 10
    const padTop = 20
    const padBot = 20
    const x = (i: number) => padX + (i / 5) * (W - 2 * padX)
    const y = (v: number) => padTop + (1 - (v - minV) / span) * (H - padTop - padBot)
    const pts = months.map((m, i) => ({ ...m, cx: x(i), cy: y(m.net) }))
    const latest = vals[vals.length - 1]
    // 只标关键点：最高(峰)/最低(谷)/最新，去重；峰标在点下方避免顶部裁切，其余标上方。
    // 边缘点锚点靠边，防止金额文字溢出左右。精确值仍可拖动读取。
    const maxData = Math.max(...vals)
    const minData = Math.min(...vals)
    const idxMax = vals.indexOf(maxData)
    const idxMin = vals.indexOf(minData)
    const valuePts = Array.from(new Set([idxMax, idxMin, 5])).map((i) => ({
      key: pts[i].key,
      cx: pts[i].cx,
      cy: pts[i].cy,
      net: pts[i].net,
      place: i === idxMax ? 'below' : 'above',
      anchor: (i === 0 ? 'start' : i === 5 ? 'end' : 'middle') as 'start' | 'end' | 'middle',
    }))
    // 趋势方向（供读屏概述用）：最新 vs 最早非零月，>1% 才算升/降，否则持平
    const firstV = vals[0]
    const diff = latest - firstV
    const dir = Math.abs(diff) <= Math.abs(firstV) * 0.01 ? 'flat' : diff > 0 ? 'rising' : 'falling'
    // 判定对象=最近一个「完整月」（倒数第二个点）：当月进行中数字是残值，拿它比会整月初都误报 BELOW。
    // 这也正是"月度复盘"的落点——上月高于/在/低于你自己的正常水平。
    const prev = months[4]
    const verdict = range
      ? {
          label: prev.label,
          kind: prev.net > range.hi ? 'above' : prev.net < range.lo ? 'below' : 'in',
        }
      : null
    // 带几何（svg 坐标，注意 y 轴反向：hi 在上）
    const band = range ? { top: y(range.hi), bot: y(range.lo), lo: range.lo, hi: range.hi } : null
    return {
      W,
      H,
      padTop,
      plotBot: H - padBot,
      pts,
      valuePts,
      line: pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
      zeroY: minV < 0 && maxV > 0 ? y(0) : null,
      latest,
      dir,
      band,
      verdict,
      hasData: vals.some((v) => v !== 0),
    }
  }, [projects, overheadByKey])



  // 瀑布条 popover：切月/切范围时收起（否则会带着旧月数据静默跟到新月），
  // 打开时点分段外自动关闭（ix-2）
  useEffect(() => {
    setWfPop(null)
  }, [monthKey, scope])
  useEffect(() => {
    if (wfPop === null) return
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement
      if (!t.closest('.net-wf-seg')) setWfPop(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [wfPop])

  const shiftRange = (step: -1 | 1) => {
    haptic(8) // 与 Home shiftMonth 同款触感
    if (scope === 'month') setCursor((d) => addMonths(d, step))
    if (scope === 'year') setCursor((d) => addYears(d, step))
  }
  // 回到当前时段（与 Home/Calendar 同款 he-month-back）：翻离本月/本年时标题变可点，点它跳回。
  const isCurrentPeriod =
    scope === 'month' ? format(cursor, 'yyyy-MM') === today.slice(0, 7) : year === Number(today.slice(0, 4))
  const backToNow = () => {
    haptic(8)
    setCursor(new Date())
  }

  const yearProjects = useMemo(
    () => projects.filter((p) => projectDataDay(p)?.startsWith(yearKey)),
    [projects, yearKey],
  )

  const monthlyMetrics = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const key = `${yearKey}-${pad2(i + 1)}`
        const list = yearProjects.filter((p) => projectDataDay(p)?.startsWith(key))
        const released = yearProjects.filter((p) => projectReleaseDay(p)?.startsWith(key))
        const monthIncome = sum(list, projectIncome)
        const monthSpend = sum(list, projectAdSpend)
        const monthOther = sum(list, projectOtherExpense)
        const monthOverhead = overheadAt(key)
        const commercialList = released.filter(isCommercialProject)
        const commercial = commercialList.length
        const adIncome = sum(commercialList, projectIncome)
        return {
          index: i,
          label: format(new Date(year, i, 1), 'MMM'),
          income: monthIncome,
          spend: monthSpend,
          other: monthOther,
          overhead: monthOverhead,
          cost: monthSpend + monthOther + monthOverhead,
          net: sum(list, projectNet) - monthOverhead,
          videos: released.length,
          commercial,
          own: released.length - commercial,
          // 客单价 = 商单收入 ÷ 商单条数（无商单月 → null，不画点）
          avgDeal: commercial > 0 ? adIncome / commercial : null,
        }
      }),
    [year, yearKey, yearProjects, overheadByKey],
  )
  const releaseTotal = sum(monthlyMetrics, (item) => item.videos)
  const maxMonthlyVideos = Math.max(1, ...monthlyMetrics.map((item) => Math.max(item.own, item.commercial)))
  const commercialVideoTotal = sum(monthlyMetrics, (item) => item.commercial)
  const ownVideoTotal = releaseTotal - commercialVideoTotal
  const mostReleaseMonth = monthlyMetrics.reduce((best, item) => (item.videos > best.videos ? item : best), monthlyMetrics[0])
  const activeMonths = monthlyMetrics.filter((item) => item.videos > 0 || item.income > 0 || item.spend > 0).length
  // 效率合成（护城河量化）：全年聚合额 ÷ 视频/投流，全部由 monthlyMetrics 求和再相除；
  // 绝不改 money.ts / 任何口径，纯展示派生。除零 → null（渲染成 —），把「总量」升到「效率」叙事。
  const yearNetTotal = sum(monthlyMetrics, (item) => item.net)
  const yearAdTotal = sum(monthlyMetrics, (item) => item.spend)
  const yearIncomeTotal = sum(monthlyMetrics, (item) => item.income)
  // Efficiency 卡改「每月节奏」：月均净利 / 月均营收 / 净利率——全是年度独有指标，
  // 与 Ad deals 的「每单」口径零重叠（原 Net·video / Ad·video 在几乎全商单的数据里
  // 与 Ad deals 的 Net·deal / Avg spend 同数，真机反馈重复）。除零 → null 渲染成 —。
  const netPerMonth = activeMonths > 0 ? yearNetTotal / activeMonths : null
  const revPerMonth = activeMonths > 0 ? yearIncomeTotal / activeMonths : null
  const margin = yearIncomeTotal > 0 ? yearNetTotal / yearIncomeTotal : null
  const openMonth = (monthIndex: number) => {
    haptic(8)
    setCursor(new Date(year, monthIndex, 1))
    setScope('month')
  }
  // 趋势线轻点某月的点 → 跳到该月（月键可跨年，不走 openMonth 的 index+当前 year）
  const jumpToMonth = (key: string) => {
    haptic(8)
    setCursor(fromKey(`${key}-01`))
    setScope('month')
  }
  // hero 双卡改为纯展示（不再作跨页跳转门）：真机反馈顶部卡一点就跳走、打断读数，
  // 故取消 Revenue→订单 / Posts→Insights 的跳转，卡片静态呈现。onOpenOrders/onOpenInsights
  // props 保留（App 仍传入）但此页不再消费。
  // 年视图未来月（相对今天真实月份）：更淡更窄，避免和已发生的月份抢注意力
  const curYear = Number(today.slice(0, 4))
  const curMonthIdx = Number(today.slice(5, 7)) - 1
  const isFutureMonth = (idx: number) => year > curYear || (year === curYear && idx > curMonthIdx)

  // 逐月「收入」「净利」两条独立折线（年视图专属）：各自独立定标（收入 0..峰、净利含谷跨 0），
  // 分开两张卡各看各的量级。口径跟随所选年，替代与所选年无关的滚动 6 月线。隔月显示月名避免碰撞；
  // dim(未来月) 在 JSX 里按 point 补。几何共享 W/H/padX。
  const yearMoney = useMemo(() => {
    // 截到最后一个「有活动」的月：其后（未来 / 未写的空月）都是 0，不再拖一条平线到年底；
    // x 按截断后的月数铺满卡宽，右侧不留死白。
    let lastActive = 0
    monthlyMetrics.forEach((m, i) => {
      if (m.income !== 0 || m.net !== 0 || m.videos > 0 || m.cost > 0) lastActive = i
    })
    const shown = monthlyMetrics.slice(0, lastActive + 1)
    const nets = shown.map((m) => m.net)
    const incomes = shown.map((m) => m.income)
    const W = 320
    const H = 92
    const padX = 12
    const padTop = 18
    const padBot = 22
    const x = (i: number) => padX + (i / Math.max(1, lastActive)) * (W - 2 * padX)
    const scaleY = (min: number, max: number) => {
      const span = max - min || 1
      return (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBot)
    }
    const mkPts = (vals: number[], y: (v: number) => number, valueIdx: Set<number>) =>
      shown.map((m, i) => ({
        id: String(m.index),
        cx: x(i),
        cy: y(vals[i]),
        label: i % 2 === 0 ? m.label : '',
        value: vals[i],
        name: m.label,
        showValue: valueIdx.has(i),
      }))
    const lineOf = (pts: { cx: number; cy: number }[]) => pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')
    // 净利：含谷跨 0 定标 + 峰/谷直标
    const nMin = Math.min(0, ...nets)
    const nMax = Math.max(0, ...nets)
    const ny = scaleY(nMin, nMax)
    const nIdxMax = nets.indexOf(Math.max(...nets))
    const nIdxMin = nets.indexOf(Math.min(...nets))
    const netPts = mkPts(nets, ny, new Set([nIdxMax, nIdxMin].filter((i) => nets[i] !== 0)))
    // 收入：0..峰 定标 + 峰直标
    const rMax = Math.max(...incomes, 0)
    const rIdxMax = incomes.indexOf(rMax)
    const revPts = mkPts(incomes, scaleY(0, rMax), new Set(rMax > 0 ? [rIdxMax] : []))
    return {
      W,
      H,
      padTop,
      plotBot: H - padBot,
      net: {
        pts: netPts,
        line: lineOf(netPts),
        zeroY: nMin < 0 && nMax > 0 ? ny(0) : null,
        hasData: nets.some((v) => v !== 0),
      },
      rev: {
        pts: revPts,
        line: lineOf(revPts),
        hasData: incomes.some((v) => v > 0),
      },
    }
  }, [monthlyMetrics])
  // 客单价趋势（年视图专属）：每月商单均收 avgDeal 的折线，回答"我的报价在涨吗"。
  // 只画有商单的月份（avgDeal !== null）；无商单月点缺省。几何同 yearTrend 的 W/H/padX，
  // x 仍按月份序（缺数据的月留空），y 按有数据月的 min/max 定标。
  const dealTrend = useMemo(() => {
    const dataPts = monthlyMetrics.map((m, i) => ({ ...m, i, v: m.avgDeal })).filter((p) => p.v !== null)
    if (dataPts.length === 0) return { hasData: false, pts: [], line: '', valuePts: [], W: 320, H: 80, padTop: 20, plotBot: 58 }
    // 与收入/净利图同口径：x 按最后一个有活动的月铺满卡宽（月份对齐、右侧不留死白）
    let lastActive = 0
    monthlyMetrics.forEach((m, i) => {
      if (m.income !== 0 || m.net !== 0 || m.videos > 0 || m.cost > 0) lastActive = i
    })
    const W = 320
    const H = 80
    const padX = 12
    const padTop = 20
    const padBot = 22
    const vals = dataPts.map((p) => p.v as number)
    const maxV = Math.max(...vals)
    const minV = Math.min(...vals)
    const span = maxV - minV || 1
    const x = (i: number) => padX + (i / Math.max(1, lastActive)) * (W - 2 * padX)
    const y = (v: number) => padTop + (1 - (v - minV) / span) * (H - padTop - padBot)
    const pts = dataPts.map((p) => ({
      ...p,
      cx: x(p.i),
      cy: y(p.v as number),
    }))
    const idxMax = vals.indexOf(maxV)
    const idxMin = vals.indexOf(minV)
    const valuePts = Array.from(new Set([idxMax, idxMin])).map((idx) => ({
      key: pts[idx].label,
      cx: pts[idx].cx,
      cy: pts[idx].cy,
      v: pts[idx].v as number,
      place: idx === idxMax ? 'below' : 'above',
      anchor: (pts[idx].i <= 1 ? 'start' : pts[idx].i >= 10 ? 'end' : 'middle') as 'start' | 'end' | 'middle',
    }))
    return {
      W,
      H,
      padTop,
      plotBot: H - padBot,
      pts,
      valuePts,
      peak: { label: pts[idxMax].label, v: maxV },
      line: pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
      hasData: true,
    }
  }, [monthlyMetrics])

  // 发布数（内容统一后 AD/OWN 同源于 projects，按发布日归月/年）：
  //   已发布 = status published/settled 且发布日在范围内
  //   ads    = 其中商单(Commercial)条数；own = 其余
  const publishStats = useMemo(() => {
    const inRange = (date?: string) =>
      !!date && (scope === 'year' ? date.startsWith(yearKey) : date.startsWith(monthKey))
    const published = projects.filter(
      (p) => (p.status === 'published' || p.status === 'settled') && inRange(projectReleaseDay(p)),
    )
    const ads = published.filter(isCommercialProject).length
    return { total: published.length, ads }
  }, [projects, scope, monthKey, yearKey])

  // 固定支出（不挂项目）：在所选月份里手动记/改一笔
  const sortedOverheads = useMemo(
    () => [...rangeOverheads].sort((a, b) => a.date.localeCompare(b.date)),
    [rangeOverheads],
  )
  // 周期性开销识别（借鉴 Copilot）：识别逻辑在 db 层，这里挑第一条未被本次会话忽略的建议展示
  const recurringHint = useMemo(() => {
    if (demoMode) return null
    const hints = detectRecurringOverheads(overheads, today.slice(0, 7))
    return hints.find((h) => !dismissedRecur.has(recurHintKey(h))) ?? null
  }, [overheads, today, dismissedRecur, demoMode])
  const recurNextLabel = recurringHint ? format(fromKey(`${recurringHint.nextMonthKey}-01`), 'MMM yyyy') : ''
  // 当前范围内按科目聚合（Year 视图汇总卡用）：金额降序
  const overheadByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of rangeOverheads) map.set(o.category, (map.get(o.category) ?? 0) + o.amount)
    return Array.from(map, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
  }, [rangeOverheads])
  const overheadCatMax = Math.max(1, ...overheadByCategory.map((c) => c.amount))
  const openOverhead = (existing?: Overhead) => {
    const draft: OverheadDraft = existing
      ? {
          id: existing.id,
          amount: String(existing.amount),
          category: existing.category,
          date: existing.date,
          note: existing.note ?? '',
        }
      : {
          id: null,
          amount: '',
          category: OVERHEAD_CATEGORIES[0],
          // 默认落在当前查看的月份：当月用今天，否则用该月 1 号
          date: today.startsWith(monthKey) ? today : `${monthKey}-01`,
          note: '',
        }
    setOhId(draft.id)
    setOhAmount(draft.amount)
    setOhCat(draft.category)
    setOhDate(draft.date)
    setOhNote(draft.note)
    setOhInitial(draft)
    setOhOpen(true)
  }
  const saveOverhead = async () => {
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      closeOverhead()
      return
    }
    const amt = Math.max(0, Number(ohAmount.trim().replace(/[,¥\s]/g, '')) || 0)
    if (!ohAmount.trim() || amt <= 0) {
      toast('Enter a valid amount')
      return
    }
    const cat = ohCat.trim() || OVERHEAD_CATEGORIES[0]
    if (ohId) {
      await updateOverhead(ohId, { amount: amt, category: cat, date: ohDate, note: ohNote.trim() || undefined })
    } else {
      await createOverhead({ amount: amt, category: cat, date: ohDate, note: ohNote.trim() || undefined })
    }
    toast(ohId ? 'Overhead updated' : 'Overhead added')
    closeOverhead()
  }
  const removeOverhead = async (id: string) => {
    if (demoMode) return
    const snap = overheads.find((item) => item.id === id)
    await deleteOverhead(id)
    toast(
      'Overhead deleted',
      snap
        ? {
            actionLabel: 'Undo',
            onAction: () => {
              void createOverhead(snap)
            },
          }
        : undefined,
    )
  }
  // 用既有 createOverhead 补录下月（绝不碰 money.ts / 任何口径，只是多写一条固定支出）
  const fillRecurring = async (hint: RecurringOverheadHint) => {
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      return
    }
    haptic(10)
    // 沿用最近一条的「日」推下月同日（date-fns 自动夹紧月末，如 1/31 → 2/28）
    const nextDate = format(addMonths(fromKey(hint.lastDate), 1), 'yyyy-MM-dd')
    await createOverhead({ category: hint.category, amount: hint.amount, date: nextDate, note: hint.note })
    toast(`${catLabel(hint.category)} added for ${format(fromKey(nextDate), 'MMM yyyy')}`)
  }
  const dismissRecur = (hint: RecurringOverheadHint) => {
    haptic(6)
    setDismissedRecur((s) => new Set(s).add(recurHintKey(hint)))
  }

  // 趋势线 scrub：把指针横坐标映射到就近的月份点（桌面 hover 与触屏拖动共用）
  const trendPick = (clientX: number, rect: DOMRect): number => {
    const vx = ((clientX - rect.left) / rect.width) * trend6.W
    let best = 0
    let bestD = Infinity
    trend6.pts.forEach((p, i) => {
      const d = Math.abs(p.cx - vx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }
  const onTrendScrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = trendPick(e.clientX, e.currentTarget.getBoundingClientRect())
    if (i !== trendIdx) {
      haptic(3)
      setTrendIdx(i)
    }
  }
  // 轻点 vs 拖动读数：按下时记起点，抬手若又快又近（<350ms、位移<10px）判定为轻点 → 跳到该月；
  // 否则维持原 scrub 语义（拖动读数、抬手清游标）。
  const trendDown = useRef<{ x: number; y: number; t: number } | null>(null)
  const onTrendDown = (e: React.PointerEvent<SVGSVGElement>) => {
    trendDown.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    onTrendScrub(e)
  }
  const onTrendUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = trendDown.current
    trendDown.current = null
    setTrendIdx(null)
    if (d && e.timeStamp - d.t < 350 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) {
      jumpToMonth(trend6.pts[trendPick(e.clientX, e.currentTarget.getBoundingClientRect())].key)
    }
  }
  const trendActive = trendIdx !== null ? trend6.pts[trendIdx] : null

  // 应收看板（Receivables）：所有 published(已交付未回款) 单，跨月聚合——护城河从「算得清」延伸到「收得回」。
  // 纯展示聚合(既有 projectIncome)，独立于上方 Month/Year/All 范围；账龄久者(发布日最早)在前便于优先催收，未排期殿后。
  const receivables = useMemo(
    () =>
      projects
        // 仅商单进应收：内容统一后自制内容也可能是 published，但没有回款轴，不该进催收看板
        .filter((p) => p.status === 'published' && isCommercialProject(p))
        .map((p) => ({ p, day: projectReleaseDay(p) }))
        .sort((a, b) => {
          if (!a.day && !b.day) return b.p.updatedAt - a.p.updatedAt
          if (!a.day) return 1
          if (!b.day) return -1
          return a.day.localeCompare(b.day) || b.p.updatedAt - a.p.updatedAt
        }),
    [projects],
  )
  const receivableTotal = useMemo(() => sum(receivables.map((r) => r.p), projectIncome), [receivables])
  // 逾期数（展示层）：复用与订单行一致的「发布日 < 今天」判断，仅用于卡片小结与高亮
  const overdueCount = useMemo(
    () => receivables.filter((r) => !!r.day && r.day < today).length,
    [receivables, today],
  )
  // 应收看板「一键结算」：走既有 db.updateProject 置 settled（状态写入，非 money.ts）+ Undo，
  // 与页面既有 demo 守卫/toast 语汇一致；结算后该单退出 published，live query 自动移除该行。
  const settleReceivable = (p: Project) => {
    haptic(12)
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      return
    }
    const prev = p.status
    void updateProject(p.id, { status: 'settled' })
    toast('Marked as paid', {
      actionLabel: 'Undo',
      onAction: () => void updateProject(p.id, { status: prev }),
    })
  }

  // hero 双卡内容（提为变量供静态外壳复用）。已取消跳转门，两卡纯展示。
  const revenueCardBody = (
    <>
      {/* Home CardIncome 同款：货币符号退灰小一号（income 为收入合计，恒 ≥0 无负号分支） */}
      <span key={rangeLabel} className={'he-card-v he-swap' + (hideMoney ? '' : heroSz(income))}>
        <span className="he-card-cur">{currencySymbol}</span>
        {hideMoney ? '•••' : tileMoney(income).replace(/^¥/, '')}
      </span>
      <div className="he-card-l">
        Revenue
        {rangeProjects.length > 0 &&
          ` · ${rangeProjects.length} order${rangeProjects.length > 1 ? 's' : ''}`}
      </div>
      {/* hero 左卡固定 2 格（NET + ROAS）——与 Home 同款宽松 16px/12px。
          接单均价 AVG 挪到下面 Ad Performance 卡头（它本就是那串商单收入的平均值，语境更贴题，
          也不再把 hero 挤成三格）。无投放月 ROAS 缺席 → 只剩 NET 一格。 */}
      <div className="he-krow">
        <div className="he-kcell">
          <div className="he-kt">Net</div>
          <div className={'he-kn ' + (profit < 0 ? 'neg' : 'g')}>
            <Money>{krowMoney(profit)}</Money>
          </div>
        </div>
        {roas !== null && (
          <div className="he-kcell">
            <div className="he-kt">ROAS</div>
            <div className="he-kn">{`${roas >= 10 ? Math.round(roas) : roas.toFixed(1)}×`}</div>
          </div>
        )}
      </div>
    </>
  )
  const postsCardBody = (
    <>
      <span key={rangeLabel} className="he-card-v he-swap">
        {publishStats.total}
      </span>
      <div className="he-card-l">
        Posts
      </div>
      <div className="he-krow">
        <div className="he-kcell">
          <div className="he-kt">Ads</div>
          <div className="he-kn a">{publishStats.ads}</div>
        </div>
        <div className="he-kcell">
          <div className="he-kt">Own</div>
          <div className="he-kn">{publishStats.total - publishStats.ads}</div>
        </div>
      </div>
    </>
  )
  const receivablesCard = receivables.length > 0 ? (
    <section className={'data-card recv-card' + (recvExpanded ? ' recv-card-open' : '')} aria-label="Receivables">
      <button
        type="button"
        className="recv-top recv-head-btn"
        aria-expanded={recvExpanded}
        onClick={() => {
          haptic(6)
          setRecvExpanded((v) => !v)
        }}
      >
        <div className="recv-head">
          <span className="recv-kicker">Receivables</span>
          <span className="recv-sub">
            {receivables.length === 1
              ? '1 order awaiting payment'
              : `${receivables.length} orders awaiting payment`}
            {overdueCount > 0 && <span className="recv-od"> · {overdueCount} overdue</span>}
          </span>
        </div>
        <span className="recv-head-right">
          <span className="recv-total">
            <Money>{tileMoney(receivableTotal)}</Money>
          </span>
          <span className="recv-chev" aria-hidden="true"><ChevronDown /></span>
        </span>
      </button>
      {recvExpanded && (
      <div className="recv-list">
        {receivables.map(({ p, day }) => {
          const aging = recvAging(day, today)
          const tone = avatarTone(p.id || p.name || '')
          return (
            <div key={p.id} className="recv-row">
              <button type="button" className="recv-open" onClick={() => onOpen(p.id)}>
                <span
                  className={'he-oi' + (p.icon ? ' emoji' : '')}
                  style={p.icon ? undefined : { background: tone.bg, color: tone.fg }}
                  aria-hidden="true"
                >
                  {p.icon || avatarInitial(p.name)}
                </span>
                <span className="he-mid">
                  <span className="he-nm">
                    <span className="he-nm-text">{projectShortName(p.name) || p.name || 'Untitled'}</span>
                    {isCommercialProject(p) && <i className="he-ad">AD</i>}
                  </span>
                  <span className="he-dt">
                    {aging.overdue ? <i className="he-overdue">{aging.text}</i> : aging.text}
                  </span>
                </span>
              </button>
              <span className="he-rt">
                <span className="he-am">
                  <Money>{formatMoney(projectIncome(p))}</Money>
                </span>
                <button
                  type="button"
                  className="recv-settle"
                  onClick={() => settleReceivable(p)}
                  aria-label={`Mark ${p.name || 'order'} as paid`}
                >
                  Mark paid
                </button>
              </span>
            </div>
          )
        })}
      </div>
      )}
    </section>
  ) : null

  return (
    <div className="page data-page order-page el-page">
      {/* 顶部：Home 同款 he-top —— 大标题=当前范围（June 2026 / 2026），右侧仅 ‹ › 翻页。
          👁 隐藏金额退场（真机反馈：与「我的」页的 Hide amounts 开关重复，头行只留翻页）。 */}
      <header className="he-top">
        <h1 className="he-month">
          {isCurrentPeriod ? (
            <span className="he-mtext">
              {scope === 'month' ? (
                <>
                  {format(cursor, 'MMM')} <span className="he-year">{format(cursor, 'yyyy')}</span>
                </>
              ) : (
                yearKey
              )}
            </span>
          ) : (
            <button
              type="button"
              className="he-mtext he-month-back"
              onClick={backToNow}
              aria-label={scope === 'month' ? 'Back to this month' : 'Back to this year'}
            >
              {scope === 'month' ? (
                <>
                  {format(cursor, 'MMM')} <span className="he-year">{format(cursor, 'yyyy')}</span>
                </>
              ) : (
                yearKey
              )}
            </button>
          )}
        </h1>
        <div className="he-top-r">
          {/* Month/Year 收成紧凑下拉筛选（单词 + chevron，仅 ~70px），替代原双词分段——
              让出宽度给左侧长月份名（如 September 2026），不再遮挡；点开在下方浮出两项。 */}
          <div className="scope-drop-wrap">
            <button
              type="button"
              className={'scope-drop' + (scopeMenu ? ' open' : '')}
              aria-haspopup="listbox"
              aria-expanded={scopeMenu}
              aria-label="Time range"
              onClick={() => setScopeMenu((v) => !v)}
            >
              {SCOPES.find((s) => s.id === scope)?.label}
              <span className="scope-drop-chev" aria-hidden="true">
                <ChevronDown />
              </span>
            </button>
            {scopeMenu && (
              <>
                <div className="pd-stage-mask" onClick={() => setScopeMenu(false)} />
                {/* 弹出菜单复用 Calendar 筛选同款皮肤（.pd-stage-menu.cal-el-fmenu + ✓），全站下拉菜单一致 */}
                <div className="pd-stage-menu cal-el-fmenu scope-menu" role="listbox" aria-label="Time range">
                  {SCOPES.map((item) => {
                    const on = scope === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={'pd-stage-item' + (on ? ' on' : '')}
                        onClick={() => {
                          if (scope !== item.id) haptic(8)
                          setScope(item.id)
                          setScopeMenu(false)
                        }}
                      >
                        <span className="pd-stage-item-label">{item.label}</span>
                        <span className="pd-stage-check" aria-hidden={!on}>{on && <CheckIcon />}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <span className="he-mnav-group">
            <button
              type="button"
              className="he-mnav"
              onClick={() => shiftRange(-1)}
              aria-label={scope === 'month' ? 'Previous month' : 'Previous year'}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="he-mnav"
              onClick={() => shiftRange(1)}
              aria-label={scope === 'month' ? 'Next month' : 'Next year'}
            >
              <ChevronRight />
            </button>
          </span>
        </div>
      </header>

      {/* 顶部两卡：Home hero 同款语言（.he-cards——大数 + 底部 krow 小格），
          替换原 2×2 stat-quad（四张浮卡空白多、页面拉太长）。
          Revenue 卡 NET/ROAS/AVG·AD 小格；Posts 卡 ADS/OWN 小格——与 Home 双卡结构同构。
          MoM/YoY 环比与 Margin/avg 派生值全部退场（真机反馈：读不出决策价值，
          还让左卡多一层、两卡内部错位）；趋势读感交给下方 Net·last 6 months。 */}
      <section className="he-cards stat-heroes" role="group" aria-label="Key metrics">
        <div className="he-card wide">{revenueCardBody}</div>
        <div className="he-card">{postsCardBody}</div>
      </section>

      <section className="data-card order-overview" aria-label="Overview">
        {/* 卡头右侧固定 Overhead 录入圆钮，与 "Finance" 标题同行对齐（space-between）——
            比原来贴在支出行末尾更规整、录入口位置恒定不随瀑布条有无漂移。 */}
        <div className="order-overview-kicker">
          <span>Finance</span>
          {scope !== 'year' && (
            <button type="button" className="fin-oh-add" onClick={() => openOverhead()} aria-label="Add overhead">
              +
            </button>
          )}
        </div>

        {/* 净额瀑布条（借鉴 Stripe）：从到手 Revenue 起算的分段可视化。每段宽度按占 Revenue 比例，
            配色用语义色（Ad 琥珀 / Cost 灰 / Net 绿），tap 弹 popover 看名称+金额+占比 */}
        {/* 头行 Revenue/Net 大字读数已退役（真机反馈查重）：与正上方 hero 卡的 Revenue 大数、
            NET 小格逐字重复。条的各段金额全部下沉到图注当"段标签"（含 Net），tap 段仍有 popover。 */}
        {income + cost > 0 && wfSegs.length > 0 && (
          <div className="net-wf" role="group" aria-label="Net profit waterfall">
            {/* 条上方：支出分段（Ad spend / Costs，与条上琥珀/灰段对应）+ 行最右锚定的圆形 + 钮
                （录 Overhead）。年视图且无支出段（纯收入月）时整行不渲染，不留空行。 */}
            {(scope !== 'year' || wfSegs.some((s) => s.key !== 'net')) && (
              <div className="fin-stats">
                {wfSegs
                  .filter((s) => s.key !== 'net')
                  .map((s) => (
                    <span key={s.key} className="fin-stat">
                      <span className="fin-stat-k">
                        <i className={'net-wf-dot ' + s.cls} />
                        {s.label}
                      </span>
                      <b><Money>{compactMoney(s.value)}</Money></b>
                      {s.pct !== null && <span className={'fin-stat-pct ' + s.cls}>{s.pct}%</span>}
                    </span>
                  ))}
              </div>
            )}
            <div className="net-wf-bar">
              {wfSegs.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={'net-wf-seg ' + s.cls + (wfPop === s.key ? ' on' : '')}
                  style={{ width: `${s.w}%` }}
                  aria-label={`${s.label} ${moneyLabel(s.value)}${s.pct !== null ? `, ${s.pct}% of revenue` : ''}`}
                  aria-expanded={wfPop === s.key}
                  onClick={() => {
                    haptic(6)
                    setWfPop((k) => (k === s.key ? null : s.key))
                  }}
                />
              ))}
              {wfActive && (
                <div
                  className="net-wf-pop"
                  style={{ left: `${Math.min(Math.max(wfActive.start + wfActive.w / 2, 12), 88)}%` }}
                  role="status"
                >
                  <span className="net-wf-pop-name">{wfActive.label}</span>
                  <b><Money>{compactMoney(wfActive.value)}</Money></b>
                  {wfActive.pct !== null && <em>{wfActive.pct}% of revenue</em>}
                </div>
              )}
            </div>
            {/* 条下方：Net（留下的）——始终显示，含亏损月（wfSegs 在亏损时无 net 段，故直接用 profit）。
                着绿 / 亏损转玫红，与条上支出分列上下、语义清爽。 */}
            <div className="fin-net-row">
              <span className="fin-stat">
                <span className="fin-stat-k">
                  <i className="net-wf-dot wf-net" />
                  Net
                </span>
                <b className={profit < 0 ? 'neg' : 'pos'}>
                  <Money>{compactMoney(profit)}</Money>
                </b>
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Efficiency（年视图专属，Finance 后 / Ad deals 前）：月均营收 / 月均净利 / 净利率。
          三个等权横排，数值全由 monthlyMetrics 派生，除零 → —。 */}
      {scope === 'year' && activeMonths > 0 && (
        <section className="data-card year-eff-card" aria-label="Monthly pace">
          <div className="data-card-head">
            <div>
              <span className="data-eyebrow">Efficiency</span>
            </div>
            <b>{activeMonths} mo</b>
          </div>
          <div className="eff-row3">
            <div className="eff-cell3">
              <span className="eff-cell3-label">Rev / month</span>
              <span className="eff-cell3-value">{revPerMonth !== null ? <Money>{kMoney(revPerMonth)}</Money> : '—'}</span>
            </div>
            <div className="eff-cell3">
              <span className="eff-cell3-label">Net / month</span>
              <span className={'eff-cell3-value' + (netPerMonth !== null && netPerMonth < 0 ? ' neg' : '')}>
                {netPerMonth !== null ? <Money>{kMoney(netPerMonth)}</Money> : '—'}
              </span>
            </div>
            <div className="eff-cell3">
              <span className="eff-cell3-label">Margin</span>
              <span className={'eff-cell3-value' + (margin !== null && margin < 0 ? ' neg' : '')}>
                {margin !== null ? `${Math.round(margin * 100)}%` : '—'}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 商单卡（Ad deals）：接单均价的新家——WHOOP 式圆环，中心=商单条数，环填充=商单占本期
          全部内容的比例（变现密度），右侧均价 + 总收入。仅本范围有商单时出现。 */}
      {adOrders.length > 0 && (
        <section className="data-card ad-deals" aria-label="Ad deals">
          {/* 卡头不放商单总收入：本 App 内容几乎全是商单，该数与 hero Revenue 恒等重复（真机反馈）。
              本卡职责=「每单经济账」，只放均值，不放总量 */}
          <div className="data-card-head">
            <span className="data-eyebrow">Ad deals</span>
          </div>
          <div className="ad-deals-body">
            <div className="ad-ring-wrap">
              <div className="ad-ring" role="img" aria-label={`${adOrders.length} ad deals, ${Math.round(adShare * 100)}% of content`}>
                <svg viewBox="0 0 76 76" aria-hidden="true">
                  <circle className="ad-ring-track" cx="38" cy="38" r="33" />
                  <circle
                    className="ad-ring-fill"
                    cx="38"
                    cy="38"
                    r="33"
                    style={{ strokeDasharray: 207.3, strokeDashoffset: 207.3 * (1 - adShare) }}
                  />
                </svg>
                <div className="ad-ring-c">
                  <b>{adOrders.length}</b>
                  <span>{adOrders.length === 1 ? 'deal' : 'deals'}</span>
                </div>
              </div>
              {/* 环填充=商单占本期全部排期内容比例，环下补数字亮出来（真机反馈：40% 一定要有） */}
              <div className="ad-ring-cap">{Math.round(adShare * 100)}% of content</div>
            </div>
            {/* 每单经济账（三行填满环高）：AVG IN=每单均收 / AVG SPEND=每单均投（仅商单自己的投流）/
                NET·DEAL=每单净赚（均收−均投，报价决策落点，随正负着绿/玫红）。in/spend 沿用 Ad Performance 词汇 */}
            <div className="ad-deals-stats">
              <div className="ad-deals-stat">
                <span className="k">Avg in</span>
                <b><Money>{compactMoney(avgAdIncome ?? 0)}</Money></b>
              </div>
              <div className="ad-deals-stat">
                <span className="k">Avg spend</span>
                <b><Money>{compactMoney(avgAdSpend ?? 0)}</Money></b>
              </div>
              <div className="ad-deals-stat">
                <span className="k">Net / deal</span>
                <b className={avgAdNet !== null && avgAdNet < 0 ? 'neg' : 'pos'}>
                  <Money>{compactMoney(avgAdNet ?? 0)}</Money>
                </b>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 单项目投流拆解（Ad spend）：把上方聚合 Ad spend 按内容拆开。
          只看钱投到哪里：Sponsored / Own content。收入、ROAS、每单质量留给 Ad deals。 */}
      {scope !== 'year' && adPerf.shown.length > 0 && (
        <section className={'data-card ad-perf' + (adPerfExpanded ? ' adperf-open' : '')} aria-label="Ad spend">
          {/* 卡头即折叠开关（默认收起，缩短页面）：收起态显示总投放额 + 箭头，点开看逐单条形 */}
          <button
            type="button"
            className="data-card-head adperf-head"
            aria-expanded={adPerfExpanded}
            onClick={() => {
              haptic(6)
              setAdPerfExpanded((v) => !v)
            }}
          >
            <span className="data-eyebrow">Ad spend</span>
            <span className="adperf-head-right">
              <b><Money>{formatMoney(adPerf.totalSpend)}</Money></b>
              <span className="adperf-chev" aria-hidden="true"><ChevronDown /></span>
            </span>
          </button>
          {adPerfExpanded && (
          <>
          <div className="ad-perf-legend" aria-hidden="true">
            <span className="ad-lg"><i className="ad-dot amber" />Sponsored <Money>{compactMoney(adPerf.sponsoredSpend)}</Money></span>
            <span className="ad-lg"><i className="ad-dot green" />Own <Money>{compactMoney(adPerf.ownSpend)}</Money></span>
          </div>
          <div className="ad-perf-list">
            {adPerf.shown.map(({ p, spend, sponsored }) => {
              const spendW = (spend / adPerf.denom) * 100
              return (
                <button
                  key={p.id}
                  type="button"
                  className="ad-row"
                  onClick={() => onOpen(p.id)}
                  aria-label={`${p.name || 'Untitled'}: ${sponsored ? 'sponsored' : 'own content'} ad spend ${moneyLabel(spend)}`}
                >
                  <span className="ad-chev" aria-hidden="true">›</span>
                  <div className="ad-top">
                    {isCommercialProject(p) && <i className="rl-ad">AD</i>}
                    <span className="ad-nm">{p.name || 'Untitled'}</span>
                  </div>
                  <div className="ad-track">
                    <span className={'ad-seg ' + (sponsored ? 'ad-amber' : 'ad-green')} style={{ width: `${spendW}%` }} />
                  </div>
                  <div className="ad-lbls">
                    <span className="ad-flow">
                      {sponsored ? 'Sponsored' : 'Own'}
                    </span>
                    <span className="ad-meta">
                      <span className="ad-net">
                        <Money>{formatMoney(spend)}</Money>
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          </>
          )}
        </section>
      )}

      {/* 近 6 月净利趋势线：一眼看半年走势（固定滚动窗口，独立于上方月份切换）。
          仅月视图——年视图的走势由所选年的 12 点 Net·by month 折线承担（口径跟年，不再用滚动窗口） */}
      {scope === 'month' && trend6.hasData && (
        <section className="data-card net-trend" aria-label="Net profit trend">
          <div className="order-overview-kicker">
            <span>Net · last 6 months</span>
            <span className="net-trend-kr">
              {/* 个人基线判定胶囊（WHOOP 式）：最近一个完整月 vs 自己的典型区间。
                  判定对象故意不是进行中的当月——残值拿去比会整月初都误报 BELOW。
                  不带月份前缀（真机反馈:"JUN ABOVE TYPICAL" 太长,把右侧读数挤出卡外）,
                  是哪个月由 aria 报读;判定月圆点在图上也是倒数第二个,可对照 */}
              {trend6.verdict && (
                <i className={'net-verdict ' + trend6.verdict.kind}>
                  {trend6.verdict.kind === 'above'
                    ? `${trend6.verdict.label} above`
                    : trend6.verdict.kind === 'below'
                      ? `${trend6.verdict.label} below`
                      : `${trend6.verdict.label} ok`}
                </i>
              )}
              {/* 有 scrub 游标时右上跟随读该点净值，否则显示最新月 */}
              <span className={(trendActive ? trendActive.net : trend6.latest) < 0 ? 'neg' : ''}>
                <Money>{compactMoney(trendActive ? trendActive.net : trend6.latest)}</Money>
              </span>
            </span>
          </div>
          {/* 相对定位容器：SVG + 跟随游标的读数 popover 叠放 */}
          <div className="net-trend-plot">
            <svg
              className="net-trend-svg"
              viewBox={`0 0 ${trend6.W} ${trend6.H}`}
              role="img"
              aria-label={
                `Net profit over the last 6 months. Latest ${trend6.pts[trend6.pts.length - 1].label} ${moneyLabel(trend6.latest)}. Trend ${trend6.dir}.` +
                (trend6.band
                  ? ` Typical monthly range ${moneyLabel(trend6.band.lo)} to ${moneyLabel(trend6.band.hi)}.`
                  : '') +
                (trend6.verdict
                  ? ` ${trend6.verdict.label} was ${
                      trend6.verdict.kind === 'above'
                        ? 'above typical'
                        : trend6.verdict.kind === 'below'
                          ? 'below typical'
                          : 'in range'
                    }.`
                  : '') +
                ' Tap a month to open it.'
              }
              onPointerDown={onTrendDown}
              onPointerMove={onTrendScrub}
              onPointerUp={onTrendUp}
              onPointerLeave={() => {
                trendDown.current = null
                setTrendIdx(null)
              }}
              onPointerCancel={() => {
                trendDown.current = null
                setTrendIdx(null)
              }}
            >
              <title>
                Net profit, last 6 months — latest {trend6.pts[trend6.pts.length - 1].label} {moneyLabel(trend6.latest)}, trend {trend6.dir}
              </title>
              {/* 个人基线带：过去 12 个完整月净利的 25-75 分位（画在最底层，线与点浮于其上）。
                  带很薄(<12px)时不进 TYPICAL 小标——写不下 */}
              {trend6.band && (
                <>
                  <rect
                    className="net-trend-band"
                    x={10}
                    width={trend6.W - 20}
                    y={trend6.band.top}
                    height={Math.max(2, trend6.band.bot - trend6.band.top)}
                    rx={3}
                  />
                  <line
                    className="net-trend-band-edge"
                    x1={10}
                    x2={trend6.W - 10}
                    y1={trend6.band.top}
                    y2={trend6.band.top}
                  />
                  <line
                    className="net-trend-band-edge"
                    x1={10}
                    x2={trend6.W - 10}
                    y1={trend6.band.bot}
                    y2={trend6.band.bot}
                  />
                  {trend6.band.bot - trend6.band.top >= 12 && (
                    <text className="net-trend-band-label" x={14} y={trend6.band.top + 8.5}>
                      TYPICAL
                    </text>
                  )}
                </>
              )}
              {trend6.zeroY !== null && (
                <line className="net-trend-zero" x1={10} x2={trend6.W - 10} y1={trend6.zeroY} y2={trend6.zeroY} />
              )}
              <polyline className="net-trend-line" points={trend6.line} />
              {/* scrub 游标：跟随手指/指针的竖线，落在就近月份点上 */}
              {trendActive && (
                <line
                  className="net-trend-cursor"
                  x1={trendActive.cx}
                  x2={trendActive.cx}
                  y1={trend6.padTop}
                  y2={trend6.plotBot}
                />
              )}
              {trend6.pts.map((p, i) => (
                <circle
                  key={p.key}
                  className={
                    'net-trend-dot' +
                    (i === trend6.pts.length - 1 ? ' last' + (trend6.latest < 0 ? ' neg' : '') : '') +
                    (i === trendIdx ? ' active' : '')
                  }
                  cx={p.cx}
                  cy={p.cy}
                  r={i === trendIdx ? 4.5 : i === trend6.pts.length - 1 ? 4 : 2.4}
                />
              ))}
              {trend6.pts.map((p) => (
                <text key={p.key} className="net-trend-label" x={p.cx} y={trend6.H - 5}>
                  {p.label}
                </text>
              ))}
              {/* 关键点金额（峰/谷/最新）：常显直标，拖动时让位给 scrub 读数 popover */}
              {!trendActive &&
                trend6.valuePts.map((v) => (
                  <text
                    key={'val' + v.key}
                    className={'net-trend-val' + (v.net < 0 ? ' neg' : '')}
                    x={v.cx}
                    y={v.place === 'below' ? v.cy + 14 : v.cy - 7}
                    textAnchor={v.anchor}
                  >
                    {hideMoney ? '···' : compactMoney(v.net)}
                  </text>
                ))}
            </svg>
            {trendActive && (
              <div
                className="net-trend-pop"
                style={{ left: `${Math.min(Math.max((trendActive.cx / trend6.W) * 100, 14), 86)}%` }}
                role="status"
              >
                <span className="net-trend-pop-name">{trendActive.label}</span>
                <b className={trendActive.net < 0 ? 'neg' : ''}><Money>{compactMoney(trendActive.net)}</Money></b>
              </div>
            )}
          </div>
        </section>
      )}


      {/* 固定支出明细卡（新增走 Finance 卡内「+ Overhead」小按钮）：不挂项目的经营开销（税务/订阅等），
          计入上方 Cost / Net。仅有明细时才现——空月不占底部空卡。默认折叠，点卡头展开明细。 */}
      {scope !== 'year' && sortedOverheads.length > 0 && (
        <section className={'data-card overhead-card' + (ohExpanded ? ' oh-open' : '')} aria-label="Overheads">
          {/* 默认折叠：卡头一行（标题 + 总额 + 展开箭头），点击才展开明细与新增建议 */}
          <button
            type="button"
            className="oh-head order-overview-kicker"
            aria-expanded={ohExpanded}
            onClick={() => {
              haptic(6)
              setOhExpanded((v) => !v)
            }}
          >
            <span>Overheads</span>
            <span className="oh-head-right">
              <Money>{formatMoney(overheadCost)}</Money>
              <span className="oh-chev" aria-hidden="true">
                <ChevronDown />
              </span>
            </span>
          </button>
          {ohExpanded && (
          <>
          {/* 周期性开销识别（借鉴 Copilot）：同名同额连续复现且下月未记 → 一键补录下月 */}
          {recurringHint && (
            <div className="oh-recur" role="note" aria-label="Recurring overhead suggestion">
              <svg className="oh-recur-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M19.5 9A8 8 0 1 0 21 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="oh-recur-main">
                <span className="oh-recur-title">{catLabel(recurringHint.category)} recurs monthly</span>
                <span className="oh-recur-sub">
                  Add {recurNextLabel} · <Money>{formatMoney(recurringHint.amount)}</Money>
                </span>
              </div>
              <button type="button" className="oh-recur-add" onClick={() => fillRecurring(recurringHint)}>
                Add
              </button>
              <button
                type="button"
                className="oh-recur-x"
                aria-label="Dismiss suggestion"
                onClick={() => dismissRecur(recurringHint)}
              >
                <XIcon />
              </button>
            </div>
          )}
          {sortedOverheads.length > 0 && (
            <div className="oh-list">
              {sortedOverheads.map((o) => (
                <div key={o.id} className="oh-row" onClick={() => openOverhead(o)}>
                  <div className="oh-main">
                    <span className="oh-cat">{catLabel(o.category)}</span>
                    <span className="oh-sub">
                      {prettyDate(o.date)}
                      {o.note ? ` · ${o.note}` : ''}
                    </span>
                  </div>
                  <b className="oh-amt"><Money>{formatMoney(o.amount)}</Money></b>
                  <button
                    type="button"
                    className="oh-del"
                    aria-label="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeOverhead(o.id)
                    }}
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </section>
      )}

      {scope === 'year' ? (
        <>
          {/* 逐月「收入」折线：每月到手 Revenue。scrub 读该月、轻点跳进该月。与 Month/Insights 折线同款交互。 */}
          {yearMoney.rev.hasData && (
            <section className="data-card net-trend" aria-label="Revenue by month">
              <span className="data-eyebrow net-trend-eyebrow">Revenue · by month</span>
              <TrendChart
                points={yearMoney.rev.pts.map((p) => ({ ...p, dim: isFutureMonth(Number(p.id)) }))}
                line={yearMoney.rev.line}
                W={yearMoney.W}
                H={yearMoney.H}
                padTop={yearMoney.padTop}
                plotBot={yearMoney.plotBot}
                format={(v) => (hideMoney ? '···' : compactMoney(v))}
                onPointOpen={(id) => openMonth(Number(id))}
                ariaLabel={`Revenue by month, ${yearKey}. Drag to read a month, tap to open it.`}
              />
            </section>
          )}

          {/* 逐月「净利」折线：每月 Net（含零线，可为负）。scrub 读该月、轻点跳进该月。 */}
          {yearMoney.net.hasData && (
            <section className="data-card net-trend" aria-label="Net by month">
              <span className="data-eyebrow net-trend-eyebrow">Net · by month</span>
              <TrendChart
                points={yearMoney.net.pts.map((p) => ({ ...p, dim: isFutureMonth(Number(p.id)) }))}
                line={yearMoney.net.line}
                zeroY={yearMoney.net.zeroY}
                W={yearMoney.W}
                H={yearMoney.H}
                padTop={yearMoney.padTop}
                plotBot={yearMoney.plotBot}
                format={(v) => (hideMoney ? '···' : compactMoney(v))}
                onPointOpen={(id) => openMonth(Number(id))}
                ariaLabel={`Net profit by month, ${yearKey}. Drag to read a month, tap to open it.`}
              />
            </section>
          )}

          {/* 客单价（广告）逐月折线：每月商单均收 avgDeal，回答"我的报价在涨吗"。只画有商单的月份；
              升级为可交互(scrub/popover/点按跳月)，与其它折线同款。 */}
          {dealTrend.hasData && (
            <section className="data-card deal-trend" aria-label="Average ad deal size by month">
              <span className="data-eyebrow net-trend-eyebrow">Ad deal · by month</span>
              <TrendChart
                points={dealTrend.pts.map((p) => ({
                  id: String(p.i),
                  cx: p.cx,
                  cy: p.cy,
                  label: p.i % 2 === 0 ? p.label : '',
                  value: p.v ?? 0,
                  name: p.label,
                  dim: isFutureMonth(p.i),
                  showValue: dealTrend.valuePts.some((v) => v.key === p.label),
                }))}
                line={dealTrend.line}
                W={dealTrend.W}
                H={dealTrend.H}
                padTop={dealTrend.padTop}
                plotBot={dealTrend.plotBot}
                variant="deal"
                format={(v) => (hideMoney ? '···' : compactMoney(v))}
                onPointOpen={(id) => openMonth(Number(id))}
                ariaLabel={`Average ad deal size by month, ${yearKey}. Drag to read a month, tap to open it.`}
              />
            </section>
          )}

          <section className="data-card year-video-card" aria-label="Video output">
            <div className="data-card-head">
              <div>
                <span className="data-eyebrow">Video output</span>
                <div className="pd-card-h">{activeMonths} active months</div>
              </div>
              <b>{releaseTotal} videos</b>
            </div>

            <div className="year-legend">
              <span>
                <i className="legend-dot income" />
                Own
              </span>
              <span>
                <i className="legend-dot cost" />
                Ads
              </span>
            </div>

            <div className="year-chart year-video-chart">
              {monthlyMetrics.map((item) => (
                <button
                  key={item.label}
                  className={
                    (item.videos > 0 ? 'year-chart-col active' : 'year-chart-col') +
                    (isFutureMonth(item.index) ? ' future' : '')
                  }
                  onClick={() => openMonth(item.index)}
                  aria-label={`${item.label}: ${item.videos} videos, ${item.commercial} ads`}
                >
                  <span className="year-bar-pair">
                    <i
                      className="income"
                      style={{
                        height: item.own > 0 ? `${Math.max(4, (item.own / maxMonthlyVideos) * 100)}%` : 0,
                      }}
                    />
                    <i
                      className="spend"
                      style={{
                        height: item.commercial > 0 ? `${Math.max(4, (item.commercial / maxMonthlyVideos) * 100)}%` : 0,
                      }}
                    />
                  </span>
                  <span className="year-net-label">{item.videos > 0 ? item.videos : ''}</span>
                  <span className="year-chart-label">{item.label}</span>
                </button>
              ))}
            </div>

            <div className="year-video-foot">
              <span>{mostReleaseMonth.videos > 0 ? `Peak ${mostReleaseMonth.label} · ${mostReleaseMonth.videos}` : 'No releases'}</span>
              <span>
                {ownVideoTotal} own · {commercialVideoTotal} ads
              </span>
            </div>
          </section>

          {/* 全年固定支出（不挂项目）汇总：总额 + 按科目拆分；明细在 Month 视图增删 */}
          {overheadCost > 0 && (
            <section className="data-card overhead-year-card" aria-label="Overheads">
              <div className="data-card-head">
                <div>
                  <span className="data-eyebrow">Overheads</span>
                  <div className="pd-card-h">Not tied to projects</div>
                </div>
                <b><Money>{formatMoney(overheadCost)}</Money></b>
              </div>
              <div className="oh-cat-list">
                {overheadByCategory.map((c) => (
                  <div key={c.category} className="oh-cat-row">
                    <span className="oh-cat-name">{catLabel(c.category)}</span>
                    <span className="oh-cat-bar">
                      <i style={{ width: `${Math.max(6, (c.amount / overheadCatMax) * 100)}%` }} />
                    </span>
                    <b className="oh-cat-amt"><Money>{formatMoney(c.amount)}</Money></b>
                  </div>
                ))}
              </div>
              <p className="qe-hint">Add or edit individual overheads in the Month view</p>
            </section>
          )}

        </>
      ) : null}

      {receivablesCard}

      {ohOpen && (
        <Sheet
          title={ohId ? 'Edit overhead' : 'Overhead'}
          className="spend-sheet sheet-top"
          onClose={closeOverhead}
          leftActionLabel="Cancel"
          primaryLabel="Done"
          onPrimary={saveOverhead}
          primaryDisabled={!ohAmount.trim()}
          confirmOnClose={ohDirty}
        >
          <div className="pd">
            <section className="pd-card">
              <div className="td-chips spend-cats">
                {OVERHEAD_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'td-chip' + (ohCat === c ? ' on' : '')}
                    onClick={() => setOhCat(c)}
                  >
                    {catLabel(c)}
                  </button>
                ))}
              </div>

              <div className="pd-fields">
                <label className="finance-field">
                  <span>Amount</span>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={ohAmount}
                    onChange={(e) => setOhAmount(e.target.value)}
                  />
                </label>
                <label className="finance-field">
                  <span>Date<em className="qe-sub">month</em></span>
                  <button type="button" className="spend-date-btn" onClick={() => setOhDateOpen(true)}>
                    {ohDate ? prettyDate(ohDate) : '—'}
                  </button>
                </label>
              </div>

              <label className="finance-field">
                <span>Category</span>
                <input placeholder="VAT / Operating Cost / Rent…" value={ohCat} onChange={(e) => setOhCat(e.target.value)} />
              </label>

              <label className="finance-field">
                <span>Note</span>
                <input placeholder="Optional" value={ohNote} onChange={(e) => setOhNote(e.target.value)} />
              </label>
            </section>
            <p className="qe-hint">Not tied to a project · counts toward this month's cost &amp; net by date</p>
          </div>
        </Sheet>
      )}
      {ohDateOpen && (
        <DatePicker value={ohDate} onPick={(k) => setOhDate(k)} onClose={() => setOhDateOpen(false)} />
      )}
    </div>
  )
}
