import type { ReactNode } from 'react'

/**
 * 统一空状态：细线图标 + 一句引导 + 可选副提示 + 可选主操作蓝胶囊。
 * 把各处「一行灰字」的断头路升级成可一键起步的画面。
 */
export default function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-ico" aria-hidden="true">
        {icon ?? (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.4 12.4l2.4 2.4 4.8-5.2" />
          </svg>
        )}
      </div>
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {actionLabel && onAction && (
        <button className="empty-state-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
