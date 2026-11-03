import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { formatMoney } from './money'

// 货币选择（纯展示层）：只换「显示符号」，绝不动 money.ts 的数值格式化，也不动任何金额/统计口径。
// 选择存本机（localStorage，仿 privacy.tsx），默认 CNY ¥——这是展示偏好，不跟云端同步。
export type Currency = { code: string; symbol: string; label: string }

// 英文创作者出海常用币种（符号取各币日常书写体）
export const CURRENCIES: Currency[] = [
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
  { code: 'HKD', symbol: 'HK$', label: 'Hong Kong Dollar' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
]

const KEY = 'cm-currency'
const DEFAULT = CURRENCIES[0]

const read = (): Currency => {
  try {
    const code = localStorage.getItem(KEY)
    return CURRENCIES.find((c) => c.code === code) ?? DEFAULT
  } catch {
    return DEFAULT
  }
}

// money.ts 的 formatMoney 输出恒为 `[-]¥数字`：唯一的 ¥ 紧跟在可选负号之后。
// 这里只把那枚 ¥ 换成当前货币符号（负号在 ¥ 之前，天然保留："-¥1,200" → "-$1,200"）。money.ts 一行不改。
export const swapCurrencySymbol = (s: string, symbol: string): string =>
  symbol === '¥' ? s : s.replace('¥', symbol)

type Ctx = { currency: Currency; setCurrency: (code: string) => void }
const CurrencyCtx = createContext<Ctx>({ currency: DEFAULT, setCurrency: () => {} })

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCur] = useState<Currency>(read)
  const setCurrency = useCallback((code: string) => {
    const next = CURRENCIES.find((c) => c.code === code) ?? DEFAULT
    setCur(next)
    try {
      localStorage.setItem(KEY, next.code)
    } catch {
      /* 存储不可用：忽略，本会话仍生效 */
    }
  }, [])
  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency])
  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>
}

export const useCurrency = (): Ctx => useContext(CurrencyCtx)
export const useCurrencySymbol = (): string => useContext(CurrencyCtx).currency.symbol

// 展示用金额格式化：调 money.ts 的 formatMoney(n) 拿数字串，再把符号换成当前货币。数值口径零改。
export function useMoneyFmt(): (n: number) => string {
  const symbol = useCurrencySymbol()
  return useCallback((n: number) => swapCurrencySymbol(formatMoney(n), symbol), [symbol])
}
