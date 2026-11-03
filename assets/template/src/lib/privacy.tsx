import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { swapCurrencySymbol, useCurrencySymbol } from './currency'

// 「隐藏金额」隐私模式：递手机给别人看时一键把全 app 金额遮成 ¥•••。
// 状态存在本机（localStorage）——这是临时的展示动作，不跟着云端同步到其他设备。
const KEY = 'cm-hide-money'

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

type Ctx = { hideMoney: boolean; toggleHideMoney: () => void }
const PrivacyCtx = createContext<Ctx>({ hideMoney: false, toggleHideMoney: () => {} })

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hideMoney, setHide] = useState<boolean>(read)
  const toggleHideMoney = useCallback(() => {
    setHide((v) => {
      const next = !v
      try {
        localStorage.setItem(KEY, next ? '1' : '0')
      } catch {
        /* 隐私模式等：忽略 */
      }
      return next
    })
  }, [])
  // memo 化 value：仅 hideMoney 变时才换 identity，避免 App 任意 state 变（切 tab 等）就让全体消费者重渲染
  const value = useMemo(() => ({ hideMoney, toggleHideMoney }), [hideMoney, toggleHideMoney])
  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>
}

export const usePrivacy = (): Ctx => useContext(PrivacyCtx)
export const useHideMoney = (): boolean => useContext(PrivacyCtx).hideMoney

// 金额遮罩 + 货币符号展示层：
// - 未隐藏且 children 是 formatMoney 出来的字符串时，把 ¥ 换成当前货币符号（数值口径零改）。
// - 隐藏时显示 {符号}•••（bare=true 用于无符号前缀的图表数字，显示 •••）。
// - 货币符号（含可选前置负号）单独包一个 .cur-sym span：Clash Display 的 ¥ 字形横笔画会
//   物理侵入紧跟的数字、让小号金额看起来像被划掉（删除线错觉）；.cur-sym 补一点右间距隔开
//   （全站小号 ¥+数字连排处一次性根治，见 stats-2/home-10）。
export function Money({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const hide = useHideMoney()
  const symbol = useCurrencySymbol()
  if (hide) return <span className="money-hidden">{bare ? '•••' : `${symbol}•••`}</span>
  if (typeof children === 'string') {
    const swapped = swapCurrencySymbol(children, symbol)
    // 拆出前导「可选负号 + 非数字货币符号」，其后为数字主体
    const m = swapped.match(/^(-?\D+)(\d.*)$/s)
    if (m) {
      return (
        <>
          <span className="cur-sym">{m[1]}</span>
          {m[2]}
        </>
      )
    }
    return <>{swapped}</>
  }
  return <>{children}</>
}
