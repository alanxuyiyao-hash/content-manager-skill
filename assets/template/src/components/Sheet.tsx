import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import ConfirmDialog from './ConfirmDialog'
import { haptic } from '../lib/haptics'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useAndroidBackHandler } from '../hooks/useAndroidBackHandler'

type SheetProps = {
  title?: string
  onClose: () => void
  rightActionLabel?: string
  onRightAction?: () => void
  leftActionLabel?: string
  onLeftAction?: () => void
  // 主操作下沉：传了就在 sheet 底部渲染一枚拇指可及的整宽主按钮（顶栏右上不再放主操作）
  primaryLabel?: string
  onPrimary?: () => void
  // 置灰但不禁用点击：仍触发 onPrimary（用于聚焦缺失字段/提示），只是视觉降权
  primaryDisabled?: boolean
  confirmOnClose?: boolean
  confirmCloseMessage?: string
  className?: string
  children: ReactNode
}

const CLOSE_THRESHOLD = 90

/**
 * 包裹既有 .sheet 弹层：半透明遮罩淡入、顶部拖拽把手、指针「下滑关闭」。
 * 自身渲染 .sheet / .sheet-bar / .sheet-body 三层壳，children 即原 sheet-body 内容。
 */
export default function Sheet({
  title,
  onClose,
  rightActionLabel,
  onRightAction,
  leftActionLabel,
  onLeftAction,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  confirmOnClose = false,
  confirmCloseMessage = 'Discard unsaved changes?',
  className = '',
  children,
}: SheetProps) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [askClose, setAskClose] = useState(false)
  const startY = useRef(0)
  const active = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  // 焦点管理：打开移入弹层、Tab 内循环、关闭还焦点给触发元素（叠加，不影响下滑关闭/脏检查/点穿透护盾）
  useFocusTrap(sheetRef)
  // sheet 开：进场轻震一下（iOS 无 Vibration 时静默）
  useEffect(() => {
    haptic(8)
  }, [])

  // 注：硬件返回键拦截（pushState/popstate）已移除——它在嵌套 Sheet 交接（IconPickSheet
  // 关闭→ProjectDetail 打开）时产生竞态：旧 Sheet 的异步 history.back() 触发 popstate 关掉
  // 新 Sheet。返回键功能暂不拦截，后续如需恢复须用不依赖 history.back() 的方案。
  // 顶部浮卡(sheet-top)锚在屏幕顶部、且把手隐藏：下滑关闭方向反直觉、易把正在编辑的卡误拖没，
  // 故禁用拖拽关闭，只保留 Cancel/Done。
  const anchoredTop = className.includes('sheet-top')

  const onPointerDown = (e: PointerEvent) => {
    if (anchoredTop) return
    // 点到 header 里的按钮（取消/完成）时不启动拖拽，否则指针被 header 捕获、按钮点击失效
    if ((e.target as HTMLElement).closest('button')) return
    active.current = true
    startY.current = e.clientY
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!active.current) return
    const delta = e.clientY - startY.current
    setDy(delta > 0 ? delta : 0)
  }
  const end = () => {
    if (!active.current) return
    active.current = false
    setDragging(false)
    if (dy > CLOSE_THRESHOLD) requestClose()
    else setDy(0)
  }
  const requestClose = () => {
    haptic(8)
    if (confirmOnClose) {
      // 弹 App 内 styled 确认卡替代系统灰框；先把拖拽位移清零，否则弹层卡在被拖下去的半截位置
      setDy(0)
      setAskClose(true)
      return
    }
    onClose()
  }
  useAndroidBackHandler(() => {
    requestClose()
    return true
  })

  // Done 关闭瞬间，下方恰好露出同坐标的 Me 头像：用一层短暂透明罩吸收紧随的第二次点击，避免点穿误开。
  // z-index 压在 sheet-layer(110) 之下：弹层若因校验失败没关闭，罩在弹层背后、不挡当前操作；
  // 弹层真关闭后罩成为页面最上层，照常吸收点穿。
  const guardTapThrough = () => {
    const shield = document.createElement('div')
    shield.style.cssText = 'position:fixed;inset:0;z-index:109'
    document.body.appendChild(shield)
    setTimeout(() => shield.remove(), 350)
  }

  const overlayOpacity = dy > 0 ? Math.max(0, 1 - dy / 360) : 1
  const sheetStyle =
    dy > 0 ? { transform: 'translateY(' + dy + 'px)', transition: dragging ? 'none' : undefined } : undefined

  // portal 到 body：真机 Safari 上页面容器的层叠上下文会让弹层输给 fixed 的 tabbar
  return createPortal(
    <>
    <div className={'sheet-layer el-sheet ' + className}>
      <div className="sheet-backdrop" style={{ opacity: overlayOpacity }} onClick={() => requestClose()} />
      <div
        ref={sheetRef}
        className={'sheet' + (primaryLabel ? ' sheet-has-foot' : '')}
        style={sheetStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
      >
        <header
          className="sheet-bar"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="sheet-grip" aria-hidden="true" />
          {leftActionLabel ? (
            <button className="link-btn" onClick={onLeftAction ?? (() => requestClose())}>
              {leftActionLabel}
            </button>
          ) : (
            <span className="link-btn ghosted">Close</span>
          )}
          <span className="sheet-title" id="sheet-title">{title}</span>
          {rightActionLabel ? (
            <button
              className="link-btn strong"
              onClick={() => {
                haptic(8)
                guardTapThrough()
                onRightAction?.()
              }}
            >
              {rightActionLabel}
            </button>
          ) : (
            <span className="link-btn ghosted" aria-hidden="true">
              {primaryLabel ? '' : 'Close'}
            </span>
          )}
        </header>
        <div className="sheet-body">{children}</div>
        {primaryLabel && (
          <div className="sheet-foot">
            <button
              className={'sheet-primary' + (primaryDisabled ? ' is-disabled' : '')}
              aria-disabled={primaryDisabled}
              onClick={() => {
                haptic(8)
                guardTapThrough()
                onPrimary?.()
              }}
            >
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
    {askClose && (
      <ConfirmDialog
        title={confirmCloseMessage}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={() => {
          setAskClose(false)
          onClose()
        }}
        onCancel={() => setAskClose(false)}
      />
    )}
    </>,
    document.body,
  )
}
