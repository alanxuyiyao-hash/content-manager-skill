import type { LedgerEntry, Project } from '../types'

const BUSINESS_INCOME = '商单'
const amount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0)

const pct = (n: unknown): number => Math.min(100, amount(n))

const entries = (p: Project) => p.entries ?? []

export const isAdSpendEntry = (e: LedgerEntry): boolean => e.type === 'expense'

// 商单类收入流水（无分类的旧数据按商单算）：当报价缺省时充当报价来源，避免与报价双计
export const isBusinessIncomeEntry = (e: LedgerEntry): boolean =>
  e.type === 'income' && (!e.category || e.category === BUSINESS_INCOME)

export const projectLedgerIncome = (p: Project): number =>
  entries(p)
    .filter((e) => e.type === 'income')
    .reduce((s, e) => s + amount(e.amount), 0)

const businessLedgerIncome = (p: Project): number =>
  entries(p)
    .filter(isBusinessIncomeEntry)
    .reduce((s, e) => s + amount(e.amount), 0)

export const projectAdSpendEntries = (p: Project): LedgerEntry[] => entries(p).filter(isAdSpendEntry)

const ledgerAdSpend = (p: Project): number =>
  projectAdSpendEntries(p).reduce((s, e) => s + amount(e.amount), 0)

export const isCommercialProject = (p: Project): boolean => p.isCommercial ?? projectLedgerIncome(p) > 0

export const projectQuote = (p: Project): number => {
  if (!isCommercialProject(p)) return 0
  const explicit = amount(p.adQuote)
  return explicit || businessLedgerIncome(p)
}

export const projectRebateRate = (p: Project): number => pct(p.rebateRate)

export const projectRebate = (p: Project): number => Math.round(projectQuote(p) * projectRebateRate(p)) / 100

export const projectAdIncome = (p: Project): number => Math.max(0, projectQuote(p) - projectRebate(p))

// 投放逐笔记录合计（新数据形态：分次投放，每笔带目标/日期）
const recordsAdSpend = (p: Project): number =>
  (p.adSpends ?? []).reduce((s, r) => s + amount(r.amount), 0)

// 投放费：逐笔记录 adSpends + 旧 adSpend 单值 + 残留 expense 流水 合计。
// 新数据只写 adSpends 逐笔记录；旧数据可能仍是 adSpend 单值或 entries 里的 expense——
// 三者相加保证「未打开迁移的旧项目」在月度统计/home 卡片上也金额正确（不漏计成本）。
// 不会双计：migrateAdSpend 把旧 adSpend 单值/旧 expense 转成记录后会清零单值、清空 expense。
export const projectAdSpend = (p: Project): number =>
  recordsAdSpend(p) + ledgerAdSpend(p) + amount(p.adSpend)

// 商单报价之外的收入流水（平台分成等）；商单类流水恒排除：报价缺省时它充当报价来源，
// 有显式报价时它是同一笔商单的回款记录——都不叠在报价之上。
// （旧版「有显式报价则商单流水另计收入」会双计：详情页把推导报价物化成显式 adQuote 后，
//   同一笔旧收入流水被算两遍，净额翻倍。）
export const projectOtherIncome = (p: Project): number =>
  entries(p)
    .filter((e) => e.type === 'income' && !isBusinessIncomeEntry(e))
    .reduce((s, e) => s + amount(e.amount), 0)

export const projectOtherExpense = (p: Project): number =>
  entries(p)
    .filter((e) => e.type === 'expense' && !isAdSpendEntry(e))
    .reduce((s, e) => s + amount(e.amount), 0)

export const projectIncome = (p: Project): number =>
  isCommercialProject(p) ? projectAdIncome(p) + projectOtherIncome(p) : projectLedgerIncome(p)

export const projectExpense = (p: Project): number => projectAdSpend(p) + projectOtherExpense(p)

export const projectNet = (p: Project): number => projectIncome(p) - projectExpense(p)

export const projectHasFinancialActivity = (p: Project): boolean =>
  projectIncome(p) > 0 || projectExpense(p) > 0

export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const s = Number.isInteger(abs)
    ? abs.toLocaleString('zh-CN')
    : abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}¥${s}`
}

// 紧凑金额（Stats/Home 概览的 ¥73.4k 语言）：symbol 由调用方传入，随多币种偏好切换。
export const compactMoneyRaw = (n: number, symbol: string): string => {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1000000) return `${sign}${symbol}${(abs / 1000000).toFixed(abs % 1000000 === 0 ? 0 : 1)}m`
  if (abs >= 1000) {
    const k = Math.round(abs / 100) / 10
    // 999,950+ 四舍五入到 1000k，进位成 1m，避免显示 "symbol1000k"
    if (k >= 1000) return `${sign}${symbol}1m`
    return `${sign}${symbol}${k}k`
  }
  return `${sign}${symbol}${Math.round(abs)}`
}

// ¥ 版紧凑金额：输出契约与 formatMoney 相同（唯一的 ¥ 紧跟可选负号），
// <Money>/swapCurrencySymbol 可直接把它换成当前货币符号。
export const compactMoney = (n: number): string => compactMoneyRaw(n, '¥')
