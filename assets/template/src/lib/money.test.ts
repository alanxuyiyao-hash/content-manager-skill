import { describe, it, expect } from 'vitest'
import type { Project, LedgerEntry } from '../types'
import {
  isCommercialProject,
  projectQuote,
  projectRebate,
  projectAdIncome,
  projectAdSpend,
  projectLedgerIncome,
  projectOtherIncome,
  projectIncome,
  projectExpense,
  projectNet,
  projectHasFinancialActivity,
  formatMoney,
  compactMoney,
  compactMoneyRaw,
} from './money'

// 测试用 Project 工厂：只需传关心的字段，其余给合法默认值
const mk = (partial: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Brand X',
  status: 'lead',
  entries: [],
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...partial,
})

const income = (amount: number, category?: string): LedgerEntry => ({
  id: 'i' + amount,
  type: 'income',
  amount,
  category,
})
const expense = (amount: number, category?: string): LedgerEntry => ({
  id: 'e' + amount,
  type: 'expense',
  amount,
  category,
})

describe('isCommercialProject', () => {
  it('遵循显式 isCommercial 标记', () => {
    expect(isCommercialProject(mk({ isCommercial: true }))).toBe(true)
    expect(isCommercialProject(mk({ isCommercial: false, entries: [income(500)] }))).toBe(false)
  })
  it('旧数据未标记时按有无收入流水兜底', () => {
    expect(isCommercialProject(mk({ entries: [income(500)] }))).toBe(true)
    expect(isCommercialProject(mk({ entries: [expense(100)] }))).toBe(false)
    expect(isCommercialProject(mk({ entries: [] }))).toBe(false)
  })
})

describe('projectQuote', () => {
  it('非商单恒为 0', () => {
    expect(projectQuote(mk({ isCommercial: false }))).toBe(0)
  })
  it('优先用显式报价', () => {
    expect(projectQuote(mk({ isCommercial: true, adQuote: 8000 }))).toBe(8000)
  })
  it('报价缺省时用商单类收入流水充当报价', () => {
    const p = mk({ isCommercial: true, entries: [income(3000, '商单'), income(2000)] })
    expect(projectQuote(p)).toBe(5000) // 无分类也算商单口径
  })
})

describe('projectRebate / projectAdIncome', () => {
  it('返点 = 报价 × 比例，四舍五入到分', () => {
    expect(projectRebate(mk({ isCommercial: true, adQuote: 10000, rebateRate: 15 }))).toBe(1500)
    // 3333 * 10% = 333.3 → 四舍五入到分 333.30
    expect(projectRebate(mk({ isCommercial: true, adQuote: 3333, rebateRate: 10 }))).toBeCloseTo(333.3, 5)
  })
  it('返点比例钳制在 0–100', () => {
    expect(projectRebate(mk({ isCommercial: true, adQuote: 1000, rebateRate: 999 }))).toBe(1000)
  })
  it('税后广告收入 = max(0, 报价 − 返点)', () => {
    expect(projectAdIncome(mk({ isCommercial: true, adQuote: 10000, rebateRate: 15 }))).toBe(8500)
  })
})

describe('projectAdSpend', () => {
  it('逐笔投放记录 adSpends 合计（新数据形态：分次投放，每笔带目标）', () => {
    const p = mk({
      adSpends: [
        { id: 'as1', goal: 'engagement', amount: 200, date: '2026-07-01' },
        { id: 'as2', goal: 'followers', amount: 150 },
        { id: 'as3', goal: 'views', amount: 100 },
      ],
    })
    expect(projectAdSpend(p)).toBe(450)
    expect(projectAdSpend(mk({}))).toBe(0)
  })
  it('旧 adSpend 单值仍参与合计——避免未迁移项目在月度统计漏计成本', () => {
    expect(projectAdSpend(mk({ adSpend: 450 }))).toBe(450)
    // 未迁移旧单值 + 新逐笔记录 相加（不会双计：详情页迁移会把单值清零转成记录）
    expect(projectAdSpend(mk({ adSpend: 100, adSpends: [{ id: 'as1', goal: 'engagement', amount: 200 }] }))).toBe(300)
  })
  it('旧数据残留 expense 流水也参与合计', () => {
    // 未打开/未迁移的旧项目：adSpend 单值 + 残留 expense 条目 相加（不会双计：迁移会清空 expense）
    expect(projectAdSpend(mk({ entries: [expense(200, '投流/广告'), expense(300, '道具/物料')] }))).toBe(500)
    expect(projectAdSpend(mk({ adSpend: 200, entries: [expense(300, '投流/广告')] }))).toBe(500)
  })
  it('记录里的负数/NaN 金额被钳成 0', () => {
    const p = mk({
      adSpends: [
        { id: 'as1', goal: 'engagement', amount: -50 },
        { id: 'as2', goal: 'views', amount: Number.NaN },
        { id: 'as3', goal: 'followers', amount: 80 },
      ],
    })
    expect(projectAdSpend(p)).toBe(80)
  })
})

describe('projectOtherIncome — 防双计', () => {
  it('有显式报价时，商单流水是同一笔商单的回款记录，不叠在报价之上', () => {
    const p = mk({ isCommercial: true, adQuote: 8000, entries: [income(1000, '商单'), income(500, '平台分成')] })
    expect(projectOtherIncome(p)).toBe(500)
  })
  it('无显式报价时，商单流水被排除（已充当报价），仅计非商单收入', () => {
    const p = mk({ isCommercial: true, entries: [income(3000, '商单'), income(500, '平台分成')] })
    expect(projectOtherIncome(p)).toBe(500)
  })
  it('回归：旧项目详情页物化报价（adQuote=商单流水合计）后净额不双计', () => {
    // ad spend 现为单值字段（旧 expense 流水已迁移进 adSpend）
    const legacy = mk({ isCommercial: true, adSpend: 190, entries: [income(9000, '商单')] })
    expect(projectNet(legacy)).toBe(8810)
    // ProjectDetail 打开时 seed 会物化 adQuote = projectQuote(source)（并可能随保存落库）：
    // 收入必须仍是 9000，而不是报价 + 同一笔流水 = 17810
    const materialized = mk({ ...legacy, adQuote: projectQuote(legacy) })
    expect(projectQuote(materialized)).toBe(9000)
    expect(projectNet(materialized)).toBe(8810)
  })
})

describe('projectIncome / projectExpense / projectNet', () => {
  it('商单：税后广告收入 + 其它收入 − 支出', () => {
    const p = mk({
      isCommercial: true,
      adQuote: 10000,
      rebateRate: 10, // 返点 1000 → 广告收入 9000
      adSpend: 500, // ad spend 单值（旧 expense 流水已迁移合并）
      entries: [income(500, '平台分成')],
    })
    expect(projectIncome(p)).toBe(9500) // 9000 + 500
    expect(projectAdSpend(p)).toBe(500)
    expect(projectExpense(p)).toBe(500)
    expect(projectNet(p)).toBe(9000)
  })
  it('非商单：直接用收入流水合计', () => {
    const p = mk({ isCommercial: false, adSpend: 200, entries: [income(1200)] })
    expect(projectIncome(p)).toBe(1200)
    expect(projectNet(p)).toBe(1000)
  })
})

describe('projectHasFinancialActivity', () => {
  it('新字段 adQuote/adSpend 有金额时也算经营过，不依赖旧 entries', () => {
    expect(projectHasFinancialActivity(mk({ isCommercial: true, adQuote: 5000 }))).toBe(true)
    expect(projectHasFinancialActivity(mk({ adSpend: 300 }))).toBe(true)
    expect(projectHasFinancialActivity(mk({ entries: [income(100)] }))).toBe(true)
    expect(projectHasFinancialActivity(mk())).toBe(false)
  })
})

describe('数值防御', () => {
  it('负数/NaN 金额被钳成 0，不会污染合计', () => {
    const p = mk({ entries: [income(100), income(-50), income(Number.NaN as number)] })
    expect(projectLedgerIncome(p)).toBe(100)
  })
})

describe('formatMoney', () => {
  it('整数无小数位 + 千分位', () => {
    expect(formatMoney(1234567)).toBe('¥1,234,567')
  })
  it('非整数保留两位', () => {
    expect(formatMoney(1234.5)).toBe('¥1,234.50')
  })
  it('负数符号在货币符号之前', () => {
    expect(formatMoney(-1200)).toBe('-¥1,200')
  })
  it('零', () => {
    expect(formatMoney(0)).toBe('¥0')
  })
})

describe('compactMoney（¥73.4k 语言）', () => {
  it('千位缩成 k，一位小数', () => {
    expect(compactMoney(73380)).toBe('¥73.4k')
    expect(compactMoney(24000)).toBe('¥24k')
  })
  it('百万缩成 m；整百万无小数', () => {
    expect(compactMoney(1234567)).toBe('¥1.2m')
    expect(compactMoney(2000000)).toBe('¥2m')
  })
  it('999,950+ 进位成 1m，不出现 ¥1000k', () => {
    expect(compactMoney(999950)).toBe('¥1m')
    expect(compactMoney(999949)).toBe('¥999.9k')
  })
  it('千以下取整原样', () => {
    expect(compactMoney(999)).toBe('¥999')
    expect(compactMoney(0)).toBe('¥0')
  })
  it('负数符号在货币符号之前（与 formatMoney 同契约，swapCurrencySymbol 可换符）', () => {
    expect(compactMoney(-1200)).toBe('-¥1.2k')
  })
  it('compactMoneyRaw 符号可换/可空', () => {
    expect(compactMoneyRaw(73380, 'HK$')).toBe('HK$73.4k')
    expect(compactMoneyRaw(73380, '')).toBe('73.4k')
  })
})
