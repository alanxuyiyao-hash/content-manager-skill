import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, differenceInCalendarDays } from 'date-fns'
import { db, updateProjectStats } from '../db'
import type { Project } from '../types'
import { isCommercialProject } from '../lib/money'
import { toKey, fromKey, prettyDate } from '../lib/date'
import { parseMetrics } from '../lib/parseMetrics'
import { avatarTone, avatarInitial, projectShortName } from '../lib/avatar'
import { useTodayKey } from '../hooks/useTodayKey'
import { projectReleaseDay } from '../lib/projectSchedule'
import {
  adsVsOwn,
} from '../lib/contentStats'
import { ChevronLeft, ChevronRight, ChevronDown } from '../components/AppHeader'
import Sheet from '../components/Sheet'
import { TrendChart } from '../components/TrendChart'
import { toast } from '../components/Toast'
import { DEMO_PROJECTS } from '../lib/demo'
import { haptic } from '../lib/haptics'
import type { TabFocus } from '../App'

/* =======================================================================
   INSIGHTS · 过去 30 天发布内容的表现看板（涨粉/播放/赞藏）
   与 Stats 页分工：Stats 管钱（营收/净利/应收），本页管内容表现——
   全页零财务数据（收入/投流/ROAS 一概不出），只有 views/likes/favorites/followersGained。
   口径：滚动 30 天内发布 = published/settled 且权威发布日落在窗口内。
   ======================================================================= */

const WINDOW_DAYS = 30

// 紧凑计数（88k / 1.2m）：内容计数专用，与钱无关——不走 money.ts、不套 <Money> 隐私遮罩
const compactNum = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}m`
  if (n >= 1000) {
    const k = Math.round(n / 100) / 10
    return k >= 1000 ? '1m' : `${k}k`
  }
  return String(Math.round(n))
}

// 录入 Sheet 的四个计数输入：空串=未录（≠0），非空必须是非负整数；非法值阻止保存，避免误清空旧数据。
const parseCount = (v: string): number | undefined | null => {
  const t = v.trim().replace(/[,\s]/g, '')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

type MetricsDraft = { views: string; likes: string; favorites: string; followersGained: string }
type ParsedMetrics = Pick<Partial<Project>, 'views' | 'likes' | 'favorites' | 'followersGained'>
const draftOf = (p: Project): MetricsDraft => ({
  views: p.views !== undefined ? String(p.views) : '',
  likes: p.likes !== undefined ? String(p.likes) : '',
  favorites: p.favorites !== undefined ? String(p.favorites) : '',
  followersGained: p.followersGained !== undefined ? String(p.followersGained) : '',
})

type TrendKind = 'views' | 'engagement' | 'followers'
type PublishedRow = { p: Project; day: string }
// 手写 SVG 折线的点：每个已发布且已录该指标的笔记一个点，cx/cy 是视箱坐标
type ChartPoint = {
  id: string
  name: string
  day: string
  dayLabel: string
  value: number
  cx: number
  cy: number
  showValue: boolean
}
type ReleaseTrend = {
  kind: TrendKind
  title: string
  tracked: number
  points: ChartPoint[]
  max: number
  line: string
  medianY: number | null // 中位数在视箱内的 y 坐标（供图上横向参考线；点数 <3 时为 null 不画）
}
type WindowSummary = {
  count: number
  adsCount: number
  ownCount: number
  viewsTotal: number
  viewsTracked: number
  viewsMedian: number | null
  viewsAvg: number | null
  likesTotal: number
  favoritesTotal: number
  engagementTotal: number
  engagementMedian: number | null
  engagementAvg: number | null
  followersGainedTotal: number
  followersGainedTracked: number
  followersGainedAvg: number | null
  followersGainedMedian: number | null
}

const metricCount = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null

const medianNum = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// 趋势卡：下划线 tab 切 Views/Engagement/Followers，手写 SVG 折线（与 Stats net-trend 同款）。
// 空窗口（hasData=false）或当前指标无 tracked 数据时，渲染空骨架而非裸空。
function TrendCard({
  trendKind,
  onTrendKind,
  readout,
  readoutLabel,
  avg,
  postsCount,
  median,
  prefix,
  points,
  line,
  medianY,
  hasData,
  hasTracked,
  complete,
}: {
  trendKind: TrendKind
  onTrendKind: (k: TrendKind) => void
  readout: number | null
  readoutLabel: string
  avg: number | null
  postsCount: number
  median: number | null
  prefix: string
  points: ChartPoint[]
  line: string
  medianY: number | null
  hasData: boolean
  hasTracked: boolean
  complete: string
}) {
  const tabs: { key: TrendKind; label: string }[] = [
    { key: 'views', label: 'Views' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'followers', label: 'Followers' },
  ]
  return (
    <section className="data-card in-trend-card" aria-label="Performance trend">
      {/* hero 头：左上主读数（中位数/总量）+ across N posts，右上 avg/post 次要读数 */}
      <div className="in-trend-hero">
        <div className="in-trend-hero-main">
          <span className="in-trend-eyebrow">{activeLabel(trendKind)} · {readoutLabel}</span>
          <span className="in-trend-bigvalue">
            {hasData && hasTracked && readout !== null ? `${prefix}${compactNum(readout)}` : '—'}
          </span>
          <span className="in-trend-across">across <b>{postsCount}</b> posts</span>
        </div>
        {hasData && hasTracked && avg !== null && (
          <div className="in-trend-hero-aside">
            <span className="in-trend-aside-label">avg / post</span>
            <span className="in-trend-aside-value">{prefix}{compactNum(avg)}</span>
          </div>
        )}
      </div>

      {hasData && hasTracked ? (
        /* 与 Stats「Net · last 6 months」同款交互折线（共享 TrendChart）：scrub 游标 + popover + 震动检点 + 轻点开录入 */
        <TrendChart
          points={points.map((p) => ({
            id: p.id,
            cx: p.cx,
            cy: p.cy,
            label: p.dayLabel,
            value: p.value,
            name: p.name,
            showValue: p.showValue,
          }))}
          line={line}
          W={TW}
          H={TH}
          padTop={TTOP}
          plotBot={TBOT}
          format={(v) => `${prefix}${compactNum(v)}`}
          refY={medianY}
          refLabel="MEDIAN"
          ariaLabel={`${activeLabel(trendKind)} by release date. ${points.map((p) => `${p.dayLabel} ${p.name} ${compactNum(p.value)}`).join(', ')}. 30d median ${median !== null ? compactNum(median) : '—'}. ${complete} complete. Drag to read a post.`}
        />
      ) : (
        <div className="in-trend-empty">
          <span className="in-trend-empty-title">
            {hasData ? 'No tracked data yet' : 'Nothing published here'}
          </span>
          <span className="in-trend-empty-hint">
            {hasData ? 'Log views on a post to see its trend' : 'Publish a post to start tracking performance'}
          </span>
        </div>
      )}

      {/* segmented tab 在图表下方：填充胶囊组，选中态白底浮起，学 Stats 的分段控件语言 */}
      <div className="in-trend-seg" role="tablist" aria-label="Trend metric">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={trendKind === t.key}
            className={'in-trend-seg-btn' + (trendKind === t.key ? ' active' : '')}
            onClick={() => onTrendKind(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

const activeLabel = (k: TrendKind): string =>
  k === 'views' ? 'Views' : k === 'engagement' ? 'Likes + favorites' : 'Followers gained'

const summarizeRows = (rows: PublishedRow[]): WindowSummary => {
  const projects = rows.map(({ p }) => p)
  const adsCount = projects.filter(isCommercialProject).length
  const views = projects.map((p) => metricCount(p.views)).filter((v): v is number => v !== null)
  const engagement = projects
    .map((p) => {
      const likes = metricCount(p.likes)
      const favorites = metricCount(p.favorites)
      return likes !== null && favorites !== null ? likes + favorites : null
    })
    .filter((v): v is number => v !== null)
  const followers = projects.map((p) => metricCount(p.followersGained)).filter((v): v is number => v !== null)
  return {
    count: projects.length,
    adsCount,
    ownCount: projects.length - adsCount,
    viewsTotal: views.reduce((s, v) => s + v, 0),
    viewsTracked: views.length,
    viewsMedian: medianNum(views),
    viewsAvg: views.length > 0 ? views.reduce((s, v) => s + v, 0) / views.length : null,
    likesTotal: projects.reduce((s, p) => s + (metricCount(p.likes) ?? 0), 0),
    favoritesTotal: projects.reduce((s, p) => s + (metricCount(p.favorites) ?? 0), 0),
    engagementTotal: engagement.reduce((s, v) => s + v, 0),
    engagementMedian: medianNum(engagement),
    engagementAvg: engagement.length > 0 ? engagement.reduce((s, v) => s + v, 0) / engagement.length : null,
    followersGainedTotal: followers.reduce((s, v) => s + v, 0),
    followersGainedTracked: followers.length,
    followersGainedAvg: followers.length > 0 ? followers.reduce((s, v) => s + v, 0) / followers.length : null,
    followersGainedMedian: medianNum(followers),
  }
}

const trendDayLabel = (day: string): string => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`

const monthWindowEnd = (monthKey: string, today: string): Date => {
  const y = Number(monthKey.slice(0, 4))
  const m = Number(monthKey.slice(5, 7))
  const monthEnd = format(new Date(y, m, 0), 'yyyy-MM-dd')
  return fromKey(monthKey >= today.slice(0, 7) ? today : monthEnd)
}

const rangeText = (start: string, end: string): string => {
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const startFmt = sameYear ? 'MMM d' : 'MMM d, yyyy'
  const endFmt = sameYear ? 'MMM d' : 'MMM d, yyyy'
  return `${format(fromKey(start), startFmt)} - ${format(fromKey(end), endFmt)}`
}

// 把窗口内已发布笔记按发布日聚合成 Recharts 数据点；只收已录该指标的笔记（tracked）。
// 趋势折线视箱几何（与 Stats net-trend 同款手写 SVG）：宽 320，按点数等分 x，y 按值定标。
const TW = 320
const TH = 88
const TX0 = 14
const TTOP = 14
const TBOT = 66

const buildReleaseTrend = (
  kind: TrendKind,
  title: string,
  rows: PublishedRow[],
  valueOf: (p: Project) => number | null,
): ReleaseTrend => {
  const data = rows
    .map(({ p, day }) => {
      const value = valueOf(p)
      return value === null
        ? null
        : {
            id: p.id || p.name || Math.random().toString(36),
            name: projectShortName(p.name) || p.name || 'Untitled',
            day,
            dayLabel: trendDayLabel(day),
            value,
          }
    })
    .filter((p): p is { id: string; name: string; day: string; dayLabel: string; value: number } => p !== null)
  const max = Math.max(0, ...data.map((p) => p.value))
  const scaleMax = max > 0 ? max : 1
  const last = Math.max(0, data.length - 1)
  const maxIndex = data.findIndex((p) => p.value === max)
  const points: ChartPoint[] = data.map((p, i) => {
    const cx = data.length <= 1 ? TW / 2 : TX0 + (i / last) * (TW - TX0 * 2)
    const cy = TBOT - (p.value / scaleMax) * (TBOT - TTOP)
    return { ...p, cx, cy, showValue: data.length <= 5 || i === maxIndex || i === last }
  })
  // 中位数横向参考线：点数 <3 不画（样本太少无参考意义，与 Stats 典型带的 ≥3 门槛一致）
  const med = medianNum(data.map((p) => p.value))
  const medianY = med !== null && data.length >= 3 ? TBOT - (med / scaleMax) * (TBOT - TTOP) : null
  return {
    kind,
    title,
    tracked: points.length,
    max,
    points,
    line: points.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
    medianY,
  }
}

export default function Insights({ focus }: { focus?: TabFocus | null }) {
  const liveProjects = useLiveQuery(() => db.projects.toArray(), [], [] as Project[])
  const demoMode = new URLSearchParams(location.search).has('demo')
  const projects = demoMode ? DEMO_PROJECTS : liveProjects
  const today = useTodayKey()

  // 30 天窗口结束日：默认今天；从 Stats 某月跳来时，用该月末（当前月用今天）作为结束日。
  const [cursor, setCursor] = useState<Date>(() => (focus ? monthWindowEnd(focus.month, today) : fromKey(today)))
  const seenFocus = useRef(focus?.n ?? 0)
  useEffect(() => {
    if (!focus || focus.n === seenFocus.current) return
    seenFocus.current = focus.n
    setCursor(monthWindowEnd(focus.month, today))
  }, [focus, today])

  const endKey = toKey(cursor) > today ? today : toKey(cursor)
  const startKey = toKey(addDays(fromKey(endKey), -(WINDOW_DAYS - 1)))
  const windowLabel = rangeText(startKey, endKey)
  const isCurrentWindow = endKey === today
  const canShiftNext = endKey < today
  const shiftWindow = (dir: 1 | -1) => {
    haptic(8)
    setCursor((c) => {
      const next = addDays(c, dir * WINDOW_DAYS)
      return toKey(next) > today ? fromKey(today) : next
    })
  }
  // 回到最新 30 天窗口（与 Home/Calendar 同款 he-month-back）：翻离当前窗口时标题变可点。
  const backToCurrentWindow = () => {
    haptic(8)
    setCursor(fromKey(today))
  }

  const published = useMemo(
    () =>
      projects
        .map((p) => ({ p, day: projectReleaseDay(p) }))
        .filter((row): row is PublishedRow => {
          if (!row.day || (row.p.status !== 'published' && row.p.status !== 'settled')) return false
          return row.day >= startKey && row.day <= endKey
        })
        .sort((a, b) => a.day.localeCompare(b.day) || b.p.updatedAt - a.p.updatedAt),
    [projects, endKey, startKey],
  )
  const summary = useMemo(() => summarizeRows(published), [published])
  const vs = useMemo(() => adsVsOwn(published.map((r) => r.p)), [published])
  const releaseTrends = useMemo(
    () => [
      buildReleaseTrend('views', 'Views', published, (p) => metricCount(p.views)),
      buildReleaseTrend('engagement', 'Likes + favs', published, (p) => {
        const likes = metricCount(p.likes)
        const favorites = metricCount(p.favorites)
        return likes !== null && favorites !== null ? likes + favorites : null
      }),
      buildReleaseTrend('followers', 'Followers', published, (p) => metricCount(p.followersGained)),
    ],
    [published],
  )
  const metricCoverage = useMemo(() => {
    const rows = published.map((r) => r.p)
    return {
      complete: rows.filter(
        (p) =>
          p.views !== undefined &&
          p.likes !== undefined &&
          p.favorites !== undefined &&
          p.followersGained !== undefined,
      ).length,
      views: rows.filter((p) => p.views !== undefined).length,
      likes: rows.filter((p) => p.likes !== undefined).length,
      favorites: rows.filter((p) => p.favorites !== undefined).length,
    }
  }, [published])

  // 「数据 n 天前更新」：近 30 天说天数，更久直接给日期（demo 的合成时间戳也不至于读出天文数字）
  const updatedLabel = (ts?: number): string | null => {
    if (!ts) return null
    const d = differenceInCalendarDays(fromKey(today), fromKey(toKey(new Date(ts))))
    if (d <= 0) return 'updated today'
    if (d <= 30) return `updated ${d}d ago`
    // 跨年旧数据带年份，避免「Oct 9」被读成今年
    const sameYear = new Date(ts).getFullYear() === fromKey(today).getFullYear()
    return `updated ${format(new Date(ts), sameYear ? 'MMM d' : 'MMM d, yyyy')}`
  }

  // ---------- 趋势卡指标切换 ----------
  const [trendKind, setTrendKind] = useState<TrendKind>('views')
  // 板块折叠（学 Stats 的 header-button + chevron 模式）：明细表默认展开，Ads vs Own 默认收起
  const [releasesOpen, setReleasesOpen] = useState(true)
  const [vsOpen, setVsOpen] = useState(false)

  // ---------- 快速录入 Sheet ----------
  const [mxFor, setMxFor] = useState<Project | null>(null)
  const [mx, setMx] = useState<MetricsDraft>({ views: '', likes: '', favorites: '', followersGained: '' })
  const [mxInitial, setMxInitial] = useState<MetricsDraft | null>(null)
  // 粘贴解析：用户从平台后台复制一段文本，解析出 4 个指标填入输入框。
  // pasteOpen 控制折叠；pasteText 存原文；parsed 实时派生（非 state）。
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const parsed = useMemo(() => parseMetrics(pasteText), [pasteText])
  const parsedCount = [parsed.views, parsed.likes, parsed.favorites, parsed.followersGained].filter(
    (v) => v !== undefined,
  ).length
  const mxDirty =
    mxInitial !== null &&
    (mx.views !== mxInitial.views ||
      mx.likes !== mxInitial.likes ||
      mx.favorites !== mxInitial.favorites ||
      mx.followersGained !== mxInitial.followersGained)
  const openMetrics = (p: Project) => {
    haptic(8)
    const d = draftOf(p)
    setMx(d)
    setMxInitial(d)
    setMxFor(p)
  }
  const closeMetrics = () => {
    setMxFor(null)
    setMxInitial(null)
    setPasteOpen(false)
    setPasteText('')
  }
  // 把解析结果填进输入框：解析到的字段覆盖原值，解析不到的保留。
  const applyParsed = () => {
    if (parsedCount === 0) return
    haptic(8)
    setMx((d) => ({
      views: parsed.views !== undefined ? String(parsed.views) : d.views,
      likes: parsed.likes !== undefined ? String(parsed.likes) : d.likes,
      favorites: parsed.favorites !== undefined ? String(parsed.favorites) : d.favorites,
      followersGained:
        parsed.followersGained !== undefined ? String(parsed.followersGained) : d.followersGained,
    }))
  }
  const saveMetrics = async () => {
    if (!mxFor) return
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      closeMetrics()
      return
    }
    const validated = {
      views: parseCount(mx.views),
      likes: parseCount(mx.likes),
      favorites: parseCount(mx.favorites),
      followersGained: parseCount(mx.followersGained),
    }
    if (Object.values(validated).some((v) => v === null)) {
      toast('Use whole numbers only')
      return
    }
    const payload: ParsedMetrics = {
      views: validated.views ?? undefined,
      likes: validated.likes ?? undefined,
      favorites: validated.favorites ?? undefined,
      followersGained: validated.followersGained ?? undefined,
    }
    await updateProjectStats(mxFor.id, payload)
    toast('Data updated')
    closeMetrics()
  }
  const mxField = (key: keyof MetricsDraft, label: string) => (
    <label className="finance-field" key={key}>
      <span>{label}</span>
      <input
        inputMode="numeric"
        placeholder="—"
        value={mx[key]}
        onChange={(e) => setMx((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  )

  // 当前选中的趋势：三档都用中位数（典型每条表现）——读数口径统一，累积量另由概览卡承载。
  const activeTrend = releaseTrends.find((t) => t.kind === trendKind) ?? releaseTrends[0]
  const trendReadout =
    trendKind === 'views'
      ? summary.viewsMedian
      : trendKind === 'engagement'
        ? summary.engagementMedian
        : summary.followersGainedMedian
  const trendReadoutLabel = 'median'
  // hero 右上角的 avg/post 次要读数（与主读数同指标）
  const trendAvg =
    trendKind === 'views'
      ? summary.viewsAvg
      : trendKind === 'engagement'
        ? summary.engagementAvg
        : summary.followersGainedAvg
  const trendMedian =
    trendKind === 'views'
      ? summary.viewsMedian
      : trendKind === 'engagement'
        ? summary.engagementMedian
        : summary.followersGainedMedian
  const trendPrefix = trendKind === 'followers' ? '+' : ''
  const hasTrackedForTrend = activeTrend.tracked > 0

  return (
    <div className="page data-page order-page el-page insights-page">
      {/* 顶部：内容表现用滚动 30 天窗口；左右箭头一次移动 30 天。 */}
      <header className="he-top">
        <h1 className="he-month">
          {isCurrentWindow ? (
            <span className="he-mtext">
              Last 30 <span className="he-year">days</span>
              <span className="in-range-label">{windowLabel}</span>
            </span>
          ) : (
            <button
              type="button"
              className="he-mtext he-month-back"
              onClick={backToCurrentWindow}
              aria-label="Back to the latest 30 days"
            >
              30-day <span className="he-year">window</span>
              <span className="in-range-label">{windowLabel}</span>
            </button>
          )}
        </h1>
        <div className="he-top-r">
          <span className="he-mnav-group">
            <button type="button" className="he-mnav" onClick={() => shiftWindow(-1)} aria-label="Previous 30 days">
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="he-mnav"
              disabled={!canShiftNext}
              onClick={() => shiftWindow(1)}
              aria-label="Next 30 days"
            >
              <ChevronRight />
            </button>
          </span>
        </div>
      </header>

      {/* 大趋势卡（主角）：下划线 tab 切 Views/Engagement/Followers，Recharts 面积图。
          空窗口也渲染空骨架，给「这里会有图」的预期；指标条/明细表/Ads 在有数据时才出现。 */}
      <TrendCard
        trendKind={trendKind}
        onTrendKind={(k) => {
          haptic(6)
          setTrendKind(k)
        }}
        readout={trendReadout}
        readoutLabel={trendReadoutLabel}
        avg={trendAvg}
        postsCount={summary.count}
        median={trendMedian}
        prefix={trendPrefix}
        points={activeTrend.points}
        line={activeTrend.line}
        medianY={activeTrend.medianY}
        hasData={summary.count > 0}
        hasTracked={hasTrackedForTrend}
        complete={`${metricCoverage.complete}/${summary.count}`}
      />

      {summary.count > 0 && (
        <>
          {/* 概览卡：粉丝累积涨量做 hero 大数（大字左 + avg/post 小字右对齐同行，去掉「大字上小字下」松散感），
              下方 3 格支撑指标一律给中位数（典型每条表现——总数无决策价值故退场），与 hero/趋势卡不重复。 */}
          <section className="data-card in-overview-card" aria-label="Content overview">
            <div className="in-ov-hero">
              <div className="in-ov-hero-main">
                <span className="in-ov-eyebrow">Followers gained</span>
                <span className="in-ov-big">
                  {summary.followersGainedTracked > 0 ? `+${compactNum(summary.followersGainedTotal)}` : '—'}
                </span>
              </div>
              {/* 右上角次要读数复用趋势卡 hero 的 aside 同款样式（大写小标 + 展示字体大号数字），两卡右翼完全统一 */}
              {summary.followersGainedAvg !== null ? (
                <div className="in-trend-hero-aside">
                  <span className="in-trend-aside-label">avg / post</span>
                  <span className="in-trend-aside-value">+{compactNum(summary.followersGainedAvg)}</span>
                </div>
              ) : (
                <div className="in-trend-hero-aside">
                  <span className="in-trend-aside-label">posts</span>
                  <span className="in-trend-aside-value">{summary.count}</span>
                </div>
              )}
            </div>
            <div className="in-ov-row">
              <div className="in-ov-stat">
                <span className="in-ov-stat-label">Views</span>
                <span className="in-ov-stat-value">
                  {summary.viewsMedian !== null ? compactNum(summary.viewsMedian) : '—'}
                </span>
                <span className="in-ov-stat-sub">median</span>
              </div>
              <div className="in-ov-stat">
                <span className="in-ov-stat-label">Engagement</span>
                <span className="in-ov-stat-value">
                  {summary.engagementMedian !== null ? compactNum(summary.engagementMedian) : '—'}
                </span>
                <span className="in-ov-stat-sub">median</span>
              </div>
              <div className="in-ov-stat">
                <span className="in-ov-stat-label">Posts</span>
                <span className="in-ov-stat-value">{summary.count}</span>
                <span className="in-ov-stat-sub">this 30d</span>
              </div>
            </div>
          </section>

          {/* 30 天发布清单：可折叠（header-button + chevron，学 Stats）。展开时对齐表格行，整行点击 → 录入 Sheet。 */}
          <section
            className={'data-card in-card' + (releasesOpen ? ' in-open' : '')}
            aria-label="Releases"
          >
            <button
              type="button"
              className="in-collapse-head"
              aria-expanded={releasesOpen}
              onClick={() => { haptic(6); setReleasesOpen(v => !v) }}
            >
              <span className="in-collapse-title">Releases</span>
              <span className="in-collapse-right">
                <b>{summary.count}</b>
                <span className="in-chev"><ChevronDown /></span>
              </span>
            </button>
            {releasesOpen && (
              <>
            <div className="in-col-head" aria-hidden="true">
              <span className="in-col-date">Date</span>
              <span className="in-col-num">Views</span>
              <span className="in-col-num">L+F</span>
              <span className="in-col-num">Fans</span>
            </div>
            <div className="in-list">
              {published.map(({ p, day }) => {
                const tone = avatarTone(p.id || p.name || '')
                const updated = updatedLabel(p.statsUpdatedAt)
                const views = metricCount(p.views)
                const likes = metricCount(p.likes)
                const favorites = metricCount(p.favorites)
                const engagement = likes !== null && favorites !== null ? likes + favorites : null
                const followers = metricCount(p.followersGained)
                const missingMetric = views === null || engagement === null || followers === null
                const displayName = projectShortName(p.name) || p.name || 'Untitled'
                return (
                  <button
                    type="button"
                    key={p.id}
                    className="in-row"
                    aria-label={`${displayName}, released ${prettyDate(day)}${updated ? `, ${updated}` : ''}`}
                    onClick={() => openMetrics(p)}
                  >
                    <span
                      className={'he-oi' + (p.icon ? ' emoji' : '')}
                      style={p.icon ? undefined : { background: tone.bg, color: tone.fg }}
                      aria-hidden="true"
                    >
                      {p.icon || avatarInitial(p.name)}
                    </span>
                    <span className="in-mid">
                      <span className="he-nm">
                        <span className="he-nm-text">{displayName}</span>
                        {isCommercialProject(p) && <i className="he-ad">AD</i>}
                      </span>
                      <div className="in-row-nums">
                        <span className="in-col-date">{trendDayLabel(day)}</span>
                        <span className="in-col-num">{views !== null ? compactNum(views) : '—'}</span>
                        <span className="in-col-num">{engagement !== null ? compactNum(engagement) : '—'}</span>
                        <span className="in-col-num">
                          {followers !== null ? `+${compactNum(followers)}` : '—'}
                        </span>
                      </div>
                      {missingMetric && <span className="in-add-link">+ Add</span>}
                    </span>
                  </button>
                )
              })}
            </div>
              </>
            )}
          </section>

          {/* 商单 vs 自制：可折叠（默认收起），header 显摘要。只要有任一侧就显示
              （全商单/全自制也要让用户看到这个事实，不必两边都有）。只比条数与内容表现，不比钱 */}
          {(summary.adsCount > 0 || summary.ownCount > 0) && (
            <section
              className={'data-card in-vs-card' + (vsOpen ? ' in-open' : '')}
              aria-label="Ads vs own content"
            >
              <button
                type="button"
                className="in-collapse-head"
                aria-expanded={vsOpen}
                onClick={() => { haptic(6); setVsOpen(v => !v) }}
              >
                <span className="in-collapse-title">Ads vs Own</span>
                <span className="in-collapse-right">
                  <span className="in-collapse-sub">{summary.adsCount} ads · {summary.ownCount} own</span>
                  <span className="in-chev"><ChevronDown /></span>
                </span>
              </button>
              {vsOpen && (
                <div className="in-vs">
                  {/* 按指标成对对比：每个指标一组 Ads/Own 条，条按两者较大值归一，一眼看谁更能打 */}
                  {(
                    [
                      { key: 'views', label: 'Med views', a: vs.ads.medianViews, o: vs.own.medianViews },
                      { key: 'lf', label: 'Med L+F', a: vs.ads.medianEngagement, o: vs.own.medianEngagement },
                    ] as const
                  ).map(({ key, label, a, o }) => {
                    const max = Math.max(a ?? 0, o ?? 0, 1)
                    return (
                      <div className="in-vs-metric" key={key}>
                        <span className="in-vs-metric-label">{label}</span>
                        {(
                          [
                            { side: 'ads', name: 'Ads', v: a },
                            { side: 'own', name: 'Own', v: o },
                          ] as const
                        ).map(({ side, name, v }) => (
                          <div className="in-vs-bar-row" key={side}>
                            <span className="in-vs-side-k">{name}</span>
                            <span className="in-vs-track">
                              <i className={'in-vs-fill ' + side} style={{ width: `${((v ?? 0) / max) * 100}%` }} />
                            </span>
                            <b className="in-vs-val">{v !== null ? compactNum(v) : '—'}</b>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {mxFor && (
        <Sheet
          title={projectShortName(mxFor.name) || mxFor.name || 'Post data'}
          className="spend-sheet sheet-top"
          onClose={closeMetrics}
          leftActionLabel="Cancel"
          primaryLabel="Done"
          onPrimary={() => void saveMetrics()}
          confirmOnClose={mxDirty}
        >
          <div className="pd">
            <section className="pd-card">
              <div className="pd-fields">
                {mxField('views', 'Views')}
                {mxField('likes', 'Likes')}
              </div>
              <div className="pd-fields">
                {mxField('favorites', 'Favorites')}
                {mxField('followersGained', 'Followers')}
              </div>
            </section>
            {/* 粘贴解析：从平台后台复制一段文本，自动填入上面四个数字。
                默认折叠（点 Paste from dashboard 展开）；实时解析、预览检测结果后才允许 Apply。 */}
            <section className="pd-paste">
              <button
                type="button"
                className={'pd-paste-toggle' + (pasteOpen ? ' open' : '')}
                aria-expanded={pasteOpen}
                onClick={() => {
                  haptic(6)
                  setPasteOpen((v) => !v)
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="4" width="14" height="17" rx="2" />
                  <path d="M9 4h6v3H9z" />
                </svg>
                Paste from dashboard
              </button>
              {pasteOpen && (
                <>
                  <textarea
                    className="pd-paste-area"
                    rows={3}
                    placeholder="Paste stats copied from your platform — e.g. 播放 5.2万  点赞 1,200  收藏 380  涨粉 64"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  {pasteText.trim() && (
                    <div className="pd-paste-preview">
                      {parsedCount > 0 ? (
                        <>
                          <span className="pd-paste-detected">
                            {[
                              parsed.views !== undefined && `Views ${compactNum(parsed.views)}`,
                              parsed.likes !== undefined && `Likes ${compactNum(parsed.likes)}`,
                              parsed.favorites !== undefined && `Favs ${compactNum(parsed.favorites)}`,
                              parsed.followersGained !== undefined && `Fans +${compactNum(parsed.followersGained)}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          <button type="button" className="pd-paste-apply" onClick={applyParsed}>
                            Apply
                          </button>
                        </>
                      ) : (
                        <span className="pd-paste-none">
                          No metrics detected — check the format and try again
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
            <p className="qe-hint">
              {mxFor.statsUpdatedAt
                ? `Last updated ${format(new Date(mxFor.statsUpdatedAt), 'MMM d')} — update anytime as the post keeps performing`
                : 'Update anytime — numbers change as the post keeps performing'}
            </p>
          </div>
        </Sheet>
      )}
    </div>
  )
}
