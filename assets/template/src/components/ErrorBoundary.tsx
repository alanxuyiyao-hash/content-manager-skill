import { Component, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
  // 传入则在错误卡上显示「关闭」，用于弹层：关掉出错的 sheet 回到 app，而不必整页刷新
  onClose?: () => void
  label?: string
  // 值变化时自动清除错误态（如切 tab）：无需给边界挂 key={tab}，切走再回来能自愈，
  // 也避免 key 变化强制整棵子树 remount、重放入场动画。
  resetKey?: unknown
  // 复位时回调：keep-alive 常驻树只清错误标记会带着旧 state 立刻再崩，
  // 宿主可借此 bump key 强制子树整棵 remount（见 App 的 epoch）
  onReset?: () => void
}
interface State {
  hasError: boolean
}

// 兜住渲染期抛错，避免一处坏数据让整页变纯白且无法自救。
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ErrorBoundary]', error, info)
  }

  componentDidUpdate(prev: Props) {
    // 切 tab（resetKey 变）后若仍处错误态，自动复位：让新页面正常渲染，而不是卡在上一页的错误卡
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = () => {
    this.setState({ hasError: false })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="err-boundary">
        <div className="err-card">
          <div className="err-title">Something went wrong</div>
          <p className="err-msg">{this.props.label ?? 'This screen hit a snag. Your data is safe — a refresh usually fixes it.'}</p>
          <button className="big-btn" onClick={() => location.reload()}>
            Refresh
          </button>
          {this.props.onClose ? (
            <button
              className="big-btn outline"
              onClick={() => {
                this.reset()
                this.props.onClose?.()
              }}
            >
              Close
            </button>
          ) : (
            <button className="big-btn outline" onClick={this.reset}>
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }
}
