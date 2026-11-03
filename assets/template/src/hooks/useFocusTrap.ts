import { useEffect, type RefObject } from 'react'

// 可聚焦元素选择器（排除禁用项、隐藏输入、tabindex=-1）
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 弹层焦点管理（只叠加、不改既有交互）：
 * - 打开时把焦点移入弹层：优先落在 initialFocusRef，否则第一个可交互元素
 * - Tab / Shift+Tab 在弹层内循环（焦点陷阱）
 * - 关闭（卸载）时把焦点还给打开前的触发元素
 * 只处理 Tab；Esc 关闭与 role=dialog/alertdialog 由弹层自身保留，本 hook 不介入。
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  initialFocusRef?: RefObject<HTMLElement>,
) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 记住触发元素，卸载时把焦点还回去（iOS 点按钮常不聚焦→可能是 body，还原为无害 no-op）
    const trigger = document.activeElement as HTMLElement | null

    // 当前真正可聚焦（已渲染、非 display:none）的元素，按 DOM 顺序
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      )

    // 移入焦点
    ;(initialFocusRef?.current ?? focusables()[0])?.focus()

    // Tab 陷阱：监听绑在容器上——各弹层各自 portal 到 body、互不为 DOM 祖先，
    // 嵌套弹层（Sheet 内弹 ConfirmDialog）时只有焦点所在那层收到冒泡，天然不重复处理。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const head = list[0]
      const tail = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    container.addEventListener('keydown', onKeyDown)

    return () => {
      container.removeEventListener('keydown', onKeyDown)
      // 触发元素仍在文档内才还焦点（嵌套弹层关闭时，旧焦点可能已随其 DOM 一起卸载）
      if (trigger && trigger.isConnected) trigger.focus()
    }
  }, [containerRef, initialFocusRef])
}

export default useFocusTrap
