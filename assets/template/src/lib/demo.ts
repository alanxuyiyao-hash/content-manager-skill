import type { Project, ProjectStatus } from '../types'
import { todayKey } from './date'

const now = new Date('2026-07-05T12:00:00+08:00').getTime()
const dayMs = 24 * 60 * 60 * 1000

type DemoPost = {
  id: string
  title: string
  month: string
  day: number
  ad: boolean
  views: number
  likes: number
  favorites: number
  followers: number
  spend: number
  income?: number
  status?: ProjectStatus
  icon?: string
}

const padDay = (day: number): string => String(day).padStart(2, '0')

const demoPost = (spec: DemoPost, i: number): Project => {
  const date = `${spec.month}-${padDay(spec.day)}`
  const adIncome = spec.ad ? (spec.income ?? Math.round(spec.views / 18)) : undefined
  return {
    id: spec.id,
    name: spec.title,
    icon: spec.icon,
    status: spec.status ?? (date > todayKey() ? 'confirmed' : spec.ad ? 'settled' : 'published'),
    isCommercial: spec.ad,
    views: spec.views,
    likes: spec.likes,
    favorites: spec.favorites,
    followersGained: spec.followers,
    statsUpdatedAt: now - ((i % 6) + 1) * dayMs,
    publishDate: date,
    startDate: `${spec.month}-${padDay(Math.max(1, spec.day - 7))}`,
    endDate: date,
    releaseDeadline: date,
    // ad spend 用单值字段（旧 expense 流水已退役）
    adSpend: spec.spend > 0 ? spec.spend : undefined,
    entries: [
      ...(adIncome
        ? [{ id: `${spec.id}-income`, type: 'income' as const, category: '商单', amount: adIncome, date, note: 'Demo income' }]
        : []),
    ],
    note: '',
    createdAt: now - (i + 10) * dayMs,
    updatedAt: now - ((i % 6) + 1) * dayMs,
  }
}

const demoPosts: DemoPost[] = [
  // March: 稳定小爆款月
  { id: 'demo-2603-01', title: 'EP083 | Spring reset workflow', month: '2026-03', day: 2, ad: false, views: 54000, likes: 2600, favorites: 980, followers: 260, spend: 90 },
  { id: 'demo-2603-02', title: 'EP084 | Sponsor desk setup', month: '2026-03', day: 5, ad: true, views: 82000, likes: 3900, favorites: 1700, followers: 470, spend: 260, income: 4200 },
  { id: 'demo-2603-03', title: 'EP085 | AI notes teardown', month: '2026-03', day: 9, ad: false, views: 69000, likes: 3400, favorites: 2100, followers: 390, spend: 130 },
  { id: 'demo-2603-04', title: 'EP086 | Creator day vlog', month: '2026-03', day: 14, ad: false, views: 41000, likes: 1800, favorites: 760, followers: 170, spend: 70 },
  { id: 'demo-2603-05', title: 'EP087 | Brand toolkit short', month: '2026-03', day: 18, ad: true, views: 97000, likes: 4700, favorites: 2200, followers: 610, spend: 330, income: 5200 },
  { id: 'demo-2603-06', title: 'EP088 | Editing sprint recap', month: '2026-03', day: 23, ad: false, views: 58000, likes: 2800, favorites: 1200, followers: 300, spend: 100 },
  { id: 'demo-2603-07', title: 'EP089 | Audience Q&A cut', month: '2026-03', day: 28, ad: false, views: 73000, likes: 3600, favorites: 1400, followers: 420, spend: 120 },

  // April: 前高后低，检验折线拐点
  { id: 'demo-2604-01', title: 'EP090 | Gadget mega review', month: '2026-04', day: 3, ad: true, views: 146000, likes: 7200, favorites: 3300, followers: 910, spend: 460, income: 6800 },
  { id: 'demo-2604-02', title: 'EP091 | Prompt library tour', month: '2026-04', day: 7, ad: false, views: 118000, likes: 6100, favorites: 4100, followers: 760, spend: 210 },
  { id: 'demo-2604-03', title: 'EP092 | Desk cleanup short', month: '2026-04', day: 11, ad: false, views: 68000, likes: 3100, favorites: 1200, followers: 330, spend: 100 },
  { id: 'demo-2604-04', title: 'EP093 | Sponsor launch note', month: '2026-04', day: 15, ad: true, views: 92000, likes: 4300, favorites: 1900, followers: 520, spend: 310, income: 5600 },
  { id: 'demo-2604-05', title: 'EP094 | Behind the edit', month: '2026-04', day: 20, ad: false, views: 47000, likes: 2100, favorites: 850, followers: 210, spend: 80 },
  { id: 'demo-2604-06', title: 'EP095 | Tool stack compare', month: '2026-04', day: 24, ad: false, views: 83000, likes: 4200, favorites: 2300, followers: 480, spend: 160 },
  { id: 'demo-2604-07', title: 'EP096 | Month end lessons', month: '2026-04', day: 29, ad: false, views: 61000, likes: 2900, favorites: 1100, followers: 310, spend: 90 },

  // May: 中段爆发，检验趋势图峰值标签
  { id: 'demo-2605-01', title: 'EP097 | Travel bag setup', month: '2026-05', day: 2, ad: false, views: 52000, likes: 2400, favorites: 1300, followers: 240, spend: 80 },
  { id: 'demo-2605-02', title: 'EP098 | Sponsor app walkthrough', month: '2026-05', day: 6, ad: true, views: 88000, likes: 4100, favorites: 1900, followers: 500, spend: 280, income: 5000 },
  { id: 'demo-2605-03', title: 'EP099 | Summer teaser', month: '2026-05', day: 10, ad: true, views: 173000, likes: 8900, favorites: 5200, followers: 1240, spend: 520, income: 7600 },
  { id: 'demo-2605-04', title: 'EP100 | Notes template demo', month: '2026-05', day: 15, ad: false, views: 96000, likes: 5100, favorites: 3600, followers: 690, spend: 190 },
  { id: 'demo-2605-05', title: 'EP101 | Short-form test A', month: '2026-05', day: 19, ad: false, views: 44000, likes: 2300, favorites: 700, followers: 180, spend: 70 },
  { id: 'demo-2605-06', title: 'EP102 | Brand founder story', month: '2026-05', day: 24, ad: true, views: 121000, likes: 5800, favorites: 2600, followers: 820, spend: 390, income: 6200 },
  { id: 'demo-2605-07', title: 'EP103 | Workflow myth busting', month: '2026-05', day: 30, ad: false, views: 77000, likes: 3900, favorites: 2100, followers: 430, spend: 140 },

  // June: 当前重点审 UI 的密集月
  { id: 'demo-2606-01', title: 'EP104 | Brand launch short', month: '2026-06', day: 2, ad: true, views: 88000, likes: 4200, favorites: 1900, followers: 520, spend: 220, income: 5600 },
  { id: 'demo-2606-02', title: 'EP105 | AI tool review', month: '2026-06', day: 5, ad: false, views: 126000, likes: 6800, favorites: 4200, followers: 860, spend: 240 },
  { id: 'demo-2606-03', title: 'EP106 | Sponsor deep dive', month: '2026-06', day: 9, ad: true, views: 74000, likes: 3400, favorites: 1600, followers: 410, spend: 300, income: 4800 },
  { id: 'demo-2606-04', title: 'EP107 | Shorts batch test', month: '2026-06', day: 13, ad: false, views: 42000, likes: 2600, favorites: 780, followers: 210, spend: 120 },
  { id: 'demo-2606-05', title: 'EP108 | Viral hook teardown', month: '2026-06', day: 17, ad: false, views: 191000, likes: 9800, favorites: 6100, followers: 1480, spend: 360 },
  { id: 'demo-2606-06', title: 'EP109 | Product first look', month: '2026-06', day: 22, ad: true, views: 103000, likes: 5200, favorites: 2300, followers: 670, spend: 340, income: 6400 },
  { id: 'demo-2606-07', title: 'EP110 | Creator collab recap', month: '2026-06', day: 27, ad: false, views: 68000, likes: 3600, favorites: 1500, followers: 390, spend: 160 },

  // July: 默认打开也有数据，可快速检查当月页
  { id: 'demo-2607-01', title: 'EP111 | July planning reset', month: '2026-07', day: 1, ad: false, views: 57000, likes: 2800, favorites: 1600, followers: 330, spend: 90 },
  { id: 'demo-2607-02', title: 'EP112 | Sponsor workflow kit', month: '2026-07', day: 3, ad: true, views: 112000, likes: 5900, favorites: 2700, followers: 780, spend: 310, income: 6100 },
  { id: 'demo-2607-03', title: 'EP113 | Content OS demo', month: '2026-07', day: 6, ad: false, views: 79000, likes: 4300, favorites: 3000, followers: 560, spend: 150 },
  { id: 'demo-2607-04', title: 'EP114 | Desk camera test', month: '2026-07', day: 9, ad: false, views: 36000, likes: 1700, favorites: 650, followers: 150, spend: 60 },
  { id: 'demo-2607-05', title: 'EP115 | Brand script review', month: '2026-07', day: 13, ad: true, views: 94000, likes: 4700, favorites: 2100, followers: 590, spend: 280, income: 5400 },
  { id: 'demo-2607-06', title: 'EP116 | Long-form notes recap', month: '2026-07', day: 18, ad: false, views: 131000, likes: 7200, favorites: 4400, followers: 970, spend: 230 },
  { id: 'demo-2607-07', title: 'EP117 | Community question cut', month: '2026-07', day: 24, ad: false, views: 64000, likes: 3300, favorites: 1300, followers: 360, spend: 110 },
]

export const DEMO_PROJECTS: Project[] = [
  ...demoPosts.map(demoPost),
  {
    id: 'demo-inbox',
    name: 'EP118 | Creator collab idea',
    status: 'lead',
    isCommercial: false,
    entries: [],
    note: '',
    createdAt: now,
    updatedAt: now,
  },
]
