import { describe, it, expect } from 'vitest'
import { swapCurrencySymbol } from './currency'

describe('swapCurrencySymbol — 只换显示符号，不动数值', () => {
  it('目标就是 ¥ 时原样返回', () => {
    expect(swapCurrencySymbol('¥1,200', '¥')).toBe('¥1,200')
  })
  it('把 ¥ 换成目标符号', () => {
    expect(swapCurrencySymbol('¥1,200', '$')).toBe('$1,200')
    expect(swapCurrencySymbol('¥1,200', 'HK$')).toBe('HK$1,200')
  })
  it('负号在 ¥ 之前，天然保留', () => {
    expect(swapCurrencySymbol('-¥1,200', '$')).toBe('-$1,200')
  })
  it('只替换第一个 ¥（金额串里唯一的那枚）', () => {
    expect(swapCurrencySymbol('¥5', '€')).toBe('€5')
  })
})
