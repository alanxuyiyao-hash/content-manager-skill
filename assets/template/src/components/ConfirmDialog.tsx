import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '../lib/haptics'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useAndroidBackHandler } from '../hooks/useAndroidBackHandler'

type Props = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// App 内 styled 确认底卡：替换系统原生 confirm() 灰框（更新提示/关闭守卫/退出登录等）。
// 保持 el- 暖色风：白浮卡 + 柔阴影，主操作填充深墨胶囊、危险操作走柔玫瑰。
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 焦点管理：打开落在「取消」按钮、Tab 内循环、关闭还焦点给触发元素（叠加，不动 Esc/role）
  useFocusTrap(cardRef, cancelRef)
  useAndroidBackHandler(() => {
    onCancel()
    return true
  })
  // 进场轻震 + Esc 取消
  useEffect(() => {
    haptic(10)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="confirm-layer el-sheet" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="confirm-backdrop" onClick={onCancel} />
      <div ref={cardRef} className="confirm-card" role="document">
        <div className="confirm-title">{title}</div>
        {message && <p className="confirm-msg">{message}</p>}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-btn ghost"
            onClick={() => {
              haptic(8)
              onCancel()
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={'confirm-btn' + (danger ? ' danger' : '')}
            onClick={() => {
              haptic(8)
              onConfirm()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
