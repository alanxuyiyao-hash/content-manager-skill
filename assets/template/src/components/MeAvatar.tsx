import { useLiveQuery } from 'dexie-react-hooks'
import { getProfile } from '../db'

// 导出给 Me 页头像空态复用：同一「我」用同一枚人形，图形语言不分叉
export function PersonIcon() {
  return (
    <svg
      className="app-header-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <circle cx="12" cy="8.4" r="3.3" />
      <path d="M5.6 19.2c1.2-3.2 3.5-4.8 6.4-4.8s5.2 1.6 6.4 4.8" />
    </svg>
  )
}

// 右上角「我的」入口：设置过头像就显示圆头像，否则人形占位
export default function MeAvatar() {
  const avatar = useLiveQuery(async () => (await getProfile()).avatar, [], undefined as string | undefined)
  if (avatar) return <img className="me-avatar" src={avatar} alt="" />
  return (
    <span className="me-avatar me-avatar-empty">
      <PersonIcon />
    </span>
  )
}
