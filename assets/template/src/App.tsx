import { lazy, Suspense, useEffect, useState, useRef, useLayoutEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import Projects from './pages/Projects'
import AuthGate from './components/AuthGate'
import ErrorBoundary from './components/ErrorBoundary'
import QuickCapture from './components/QuickCapture'
import LogEntrySheet from './components/LogEntrySheet'
import { ToastHost } from './components/Toast'
import { PrivacyProvider } from './lib/privacy'
import { CurrencyProvider } from './lib/currency'
import { RemindersProvider } from './lib/reminders'
import { haptic } from './lib/haptics'
import type { Project } from './types'
import { db } from './db'
import { DEMO_PROJECTS } from './lib/demo'
import { androidBackDispatcher, createNonThrowingErrorSink, handleNativeBack } from './lib/androidBack'

const reportAndroidBackError = createNonThrowingErrorSink((error: unknown) => {
  console.error('[Android back]', error)
})

// 首屏只需 Home（Projects）；其余页面/重编辑器按需懒加载，缩小主包、加快冷启动。
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const Monthly = lazy(() => import('./pages/Monthly'))
const Insights = lazy(() => import('./pages/Insights'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Settings = lazy(() => import('./components/Settings'))

export type ProjectEditor = { mode: 'edit'; id: string } | { mode: 'new'; prefill?: Partial<Project> }

// 跨 tab 锚定：month='yyyy-MM'，n 为全局递增序号——页面按 n 判断「这是新一次跳转」，
// 同月二跳（页面翻走后再从卡片跳同一个月）也能被识别消费
export type TabFocus = { month: string; n: number }

type Tab = 'home' | 'calendar' | 'data' | 'insights' | 'my'

// 懒加载切换时的轻量占位：一枚居中柔转圈，避免整页闪白
function PageFallback() {
  return (
    <div className="page page-loading" aria-hidden="true">
      <span className="page-spinner" />
    </div>
  )
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M3.5 9h17M9 4.5v4.5M9 13h6" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'data',
    label: 'Stats',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    // Stats 管钱（财务），Insights 管内容表现（播放/赞藏）——两页相邻成「分析区」
    id: 'insights',
    label: 'Insights',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 19.5V13M9.3 19.5V9M14.6 19.5v-4.5M20 19.5V6" />
        <path d="M4 9.5l5.3-4 5.3 5.5L20 6" />
      </svg>
    ),
  },
  {
    id: 'my',
    label: 'Me',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8.5" r="3.8" />
        <path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" />
      </svg>
    ),
  },
]

export default function App() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let active = true
    let remove: (() => void) | undefined
    void CapacitorApp.addListener('backButton', () => {
      if (!active) return
      handleNativeBack(
        () => androidBackDispatcher.dispatch(),
        () => CapacitorApp.exitApp(),
        reportAndroidBackError,
      )
    }).then((handle) => {
      if (!active) void handle.remove().catch(reportAndroidBackError)
      else {
        remove = () => {
          void handle.remove().catch(reportAndroidBackError)
        }
      }
    }).catch(reportAndroidBackError)

    return () => {
      active = false
      remove?.()
    }
  }, [])

  const [tab, setTab] = useState<Tab>('home')
  // keep-alive：访问过的 tab 常驻（hidden 隐藏），切回时月份/筛选/折叠/滚动全保留；
  // 首访才挂载，保住 lazy code-splitting（首屏仍只加载 Home chunk）
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({
    home: true,
    calendar: false,
    data: false,
    insights: false,
    my: false,
  })
  // 崩溃自愈：ErrorBoundary 复位时该 tab epoch+1，强制面板整棵 remount 丢弃坏 state
  //（常驻树只清错误标记会带着旧 state 立刻再崩）
  const [epoch, setEpoch] = useState<Record<Tab, number>>({ home: 0, calendar: 0, data: 0, insights: 0, my: 0 })
  const contentRef = useRef<HTMLElement>(null)
  // 每 tab 记 .content（全 app 唯一滚动容器）的 scrollTop：display:none 保不住滚动位置，切走记、切回恢复
  const scrollPos = useRef<Record<Tab, number>>({ home: 0, calendar: 0, data: 0, insights: 0, my: 0 })
  // 跨 tab 锚定月，按卡片语义分流：
  //   statsFocus：Home Income 卡 → Stats（看该月钱的分析）；homeFocus：Stats Revenue 卡 → Home（看该月订单列表）；
  //   calFocus：两页 Posts 卡 → Calendar（看该月哪天发了什么）。
  // 仅对「从卡片进来」这一次生效——直接点 tab 栏会清掉；页面自身状态（月份/筛选/滚动）由 keep-alive 保留。
  const [statsFocus, setStatsFocus] = useState<TabFocus | null>(null)
  const [homeFocus, setHomeFocus] = useState<TabFocus | null>(null)
  const [calFocus, setCalFocus] = useState<TabFocus | null>(null)
  // insightsFocus：Stats Posts 卡 → Insights（看该月发布的内容表现）
  const [insightsFocus, setInsightsFocus] = useState<TabFocus | null>(null)
  const focusSeq = useRef(0) // 全局递增序号：清空后再跳同月 n 也不重复，页面必能识别

  const anchor = (month: string): TabFocus => ({ month, n: ++focusSeq.current })
  const bumpEpoch = (t: Tab) => setEpoch((e) => ({ ...e, [t]: e[t] + 1 }))
  const switchTab = (next: Tab) => {
    if (next === tab) return
    scrollPos.current[tab] = contentRef.current?.scrollTop ?? 0
    setMounted((m) => (m[next] ? m : { ...m, [next]: true }))
    setTab(next)
  }
  // 切 tab 后恢复该页滚动位置：layout effect 时 DOM 已完成布局，scrollTo 不会被内容高度不足截断
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, scrollPos.current[tab])
  }, [tab])
  const [projEd, setProjEd] = useState<ProjectEditor | null>(null)
  // 快速记费：项目行左滑 Log spend → 记下项目 id，弹出预选该项目的 LogEntrySheet（默认 支出·投流/广告）
  const [logFor, setLogFor] = useState<string | null>(null)
  const demoMode = new URLSearchParams(location.search).has('demo')
  // 仅在记费弹层打开时才订阅项目表（关闭时返回空、不触库，避免全应用生命周期的冗余全表订阅）；
  // demo 模式用 DEMO_PROJECTS，否则预选的 demo 项目不在 picker 列表里（demo 数据未落库）。
  const liveLogProjects = useLiveQuery(
    () => (logFor && !demoMode ? db.projects.toArray() : Promise.resolve([] as Project[])),
    [logFor, demoMode],
    [] as Project[],
  )
  const logProjects = demoMode ? DEMO_PROJECTS : liveLogProjects

  return (
    <AuthGate>
    <CurrencyProvider>
    <RemindersProvider>
    <PrivacyProvider>
    <div className="app">
      <main className="content" ref={contentRef}>
        {/* keep-alive 面板：访问过的 tab 常驻，hidden 只隐藏不卸载（.tab-panel 用 display:contents
            透传布局，[hidden] 时 display:none 不参与布局/绘制）。ErrorBoundary/Suspense 下沉到
            每个面板：崩溃/首载 spinner 只占本面板；resetKey={tab} 切走时清错误态，onReset 把该 tab
            epoch+1 → key 变整棵 remount 丢弃坏 state（对齐旧「卸载即自愈」，只牺牲崩溃页的保活） */}
        {mounted.home && (
          <div className="tab-panel" hidden={tab !== 'home'}>
            <ErrorBoundary resetKey={tab} onReset={() => bumpEpoch('home')}>
              <div key={epoch.home} style={{ display: 'contents' }}>
                <Projects
                  onOpen={(id) => setProjEd({ mode: 'edit', id })}
                  onNew={(prefill) => setProjEd({ mode: 'new', prefill })}
                  onLogSpend={(id) => setLogFor(id)}
                  onOpenStats={(monthKey) => {
                    setStatsFocus(anchor(monthKey))
                    scrollPos.current.data = 0 // 带锚定的跳转回顶：锚定月 hero 卡落在首屏
                    switchTab('data')
                  }}
                  onOpenCalendar={(monthKey) => {
                    setCalFocus(anchor(monthKey))
                    scrollPos.current.calendar = 0
                    switchTab('calendar')
                  }}
                  focus={homeFocus}
                />
              </div>
            </ErrorBoundary>
          </div>
        )}
        {mounted.calendar && (
          <div className="tab-panel" hidden={tab !== 'calendar'}>
            <ErrorBoundary resetKey={tab} onReset={() => bumpEpoch('calendar')}>
              <Suspense fallback={<PageFallback />}>
                <div key={epoch.calendar} style={{ display: 'contents' }}>
                  <CalendarPage
                    onOpen={(id) => setProjEd({ mode: 'edit', id })}
                    onNew={(prefill) => setProjEd({ mode: 'new', prefill })}
                    onLogSpend={(id) => setLogFor(id)}
                    focus={calFocus}
                  />
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted.data && (
          <div className="tab-panel" hidden={tab !== 'data'}>
            <ErrorBoundary resetKey={tab} onReset={() => bumpEpoch('data')}>
              <Suspense fallback={<PageFallback />}>
                <div key={epoch.data} style={{ display: 'contents' }}>
                  <Monthly
                    onOpen={(id) => setProjEd({ mode: 'edit', id })}
                    onNew={(prefill) => setProjEd({ mode: 'new', prefill })}
                    focus={statsFocus}
                    onOpenOrders={(monthKey) => {
                      setHomeFocus(anchor(monthKey))
                      scrollPos.current.home = 0
                      switchTab('home')
                    }}
                    onOpenInsights={(monthKey) => {
                      setInsightsFocus(anchor(monthKey))
                      scrollPos.current.insights = 0
                      switchTab('insights')
                    }}
                  />
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted.insights && (
          <div className="tab-panel" hidden={tab !== 'insights'}>
            <ErrorBoundary resetKey={tab} onReset={() => bumpEpoch('insights')}>
              <Suspense fallback={<PageFallback />}>
                <div key={epoch.insights} style={{ display: 'contents' }}>
                  <Insights focus={insightsFocus} />
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted.my && (
          <div className="tab-panel" hidden={tab !== 'my'}>
            <ErrorBoundary resetKey={tab} onReset={() => bumpEpoch('my')}>
              <Suspense fallback={<PageFallback />}>
                <div key={epoch.my} style={{ display: 'contents' }}>
                  <Settings />
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => {
              if (t.id !== tab) haptic(8)
              // 直接点 tab 栏 = 常规入口：清掉 hero 卡带过来的锚定月（锚定只对卡片跳转那一次生效，
              // 也避免页面崩溃 remount 时误消费陈旧锚定）；页面自身状态由 keep-alive 保留，不再重置
              setStatsFocus(null)
              setHomeFocus(null)
              setCalFocus(null)
              setInsightsFocus(null)
              switchTab(t.id)
            }}
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="tab-ico">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {projEd && (
        <ErrorBoundary onClose={() => setProjEd(null)}>
          <Suspense fallback={null}>
            <ProjectDetail editor={projEd} onClose={() => setProjEd(null)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {/* FAB 只在首页出：Calendar 有自己的「按选中日加内容」入口(cal-el-plus)；Stats/Me 是看数/设置页，
          无「新建内容」语义，不摆 FAB 免得突兀。 */}
      {tab === 'home' && (
        <QuickCapture onNewProject={(prefill) => setProjEd({ mode: 'new', prefill })} />
      )}
      {/* 快速记费 sheet：项目行左滑 Log spend 触发，预选该项目（默认 支出·投流/广告） */}
      {logFor && (
        <LogEntrySheet
          projects={logProjects}
          demoMode={demoMode}
          defaultProjectId={logFor}
          onClose={() => setLogFor(null)}
        />
      )}
      <ToastHost />
    </div>
    </PrivacyProvider>
    </RemindersProvider>
    </CurrencyProvider>
    </AuthGate>
  )
}
