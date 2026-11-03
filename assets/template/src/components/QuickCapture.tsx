import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Project } from '../types'
import { db } from '../db'
import { DEMO_PROJECTS } from '../lib/demo'
import IconPickSheet from './IconPickSheet'
import LogEntrySheet from './LogEntrySheet'
import { toast } from './Toast'
import { haptic } from '../lib/haptics'

// FAB 关闭态图标：羽毛笔 + 尾端墨点（quill/compose，比斜钢笔更轻更优雅）。
// 展开态换成 CloseIcon(×)——笔无法靠旋转 morph 成 ×，故两态两图标（见 render 处的三元）。
function ComposeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z" />
      <path d="M15 5l3 3" />
      <circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
// FAB 展开态图标：× 关闭。
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
// 广告费用图标：小票/账目——票据轮廓下沿锯齿 + 两条账目线，
// 与 Content（项目板）区分开，一眼是「补一笔投流费用」。
function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h12a1 1 0 0 1 1 1V20l-2.2-1.4L14.6 20l-2.6-1.6L9.4 20l-2.2-1.4V4.5a1 1 0 0 1 1-1z" />
      <path d="M9 8.5h6M9 12h6" />
    </svg>
  )
}
function ProjectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9h17M9 4.5v4.5M9 13h6" />
    </svg>
  )
}
/**
 * 全局快速新建：任意 tab 右下角悬浮按钮。点一下展开两个选项——
 * Content / Log ad spend。内容统一后只有一种对象(Project)：自制/商单进同一个详情表单，
 * 由表单内的 Commercial 开关区分（开=商单多出收入区）。Log ad spend = 给已有内容补记投流费用。
 */
export default function QuickCapture({
  onNewProject,
}: {
  onNewProject?: (prefill?: Partial<Project>) => void
}) {
  const [menu, setMenu] = useState(false)
  const demoMode = new URLSearchParams(location.search).has('demo')
  // 记一笔挂靠的内容列表：空库时不开面板，改提示先建内容。
  // demo 模式下与各页一致改用 DEMO_PROJECTS（demo 不落库，直读 db 会空）。
  const liveProjects = useLiveQuery(() => db.projects.toArray(), [], [] as Project[])
  const projects = demoMode ? DEMO_PROJECTS : liveProjects
  const [logOpen, setLogOpen] = useState(false)
  // 新建首屏：先选个封面 emoji 头像（或 Skip 用色底默认），再进详情。详情仍可改。
  const [iconPickOpen, setIconPickOpen] = useState(false)

  // 建内容：选完头像 → 开统一详情表单（Commercial 默认关，商单在表单里一键打开）。
  const startContent = (icon?: string) => {
    setIconPickOpen(false)
    onNewProject?.(icon ? { icon } : undefined)
  }

  // 记广告费：库里没有任何内容时不开面板（LogEntrySheet 依赖挂靠对象），提示先建
  const openLog = () => {
    if ((projects?.length ?? 0) === 0) {
      toast('Add content first')
      return
    }
    setLogOpen(true)
  }

  // 顶 → 底（底部最靠近 FAB 手位）：Log ad spend / Content —— 主操作「建内容」贴 FAB
  // 展开项配色：暖色状态盘（字面值——本组件在 .home-elegant 作用域外，var(--el-*) 不解析）。
  // Log ad spend=中性 stone / Content=琥珀（主操作、money 暖色）。
  const options = [
    { key: 'log', label: 'Log ad spend', color: '#6f6a5c', icon: <LogIcon />, run: openLog },
    { key: 'content', label: 'Content', color: '#b5791a', icon: <ProjectIcon />, run: () => setIconPickOpen(true) },
  ]

  return (
    <>
      {menu && <div className="qc-scrim" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="qc-menu" role="menu">
          {options.map((o) => (
            <button
              key={o.key}
              className="qc-opt"
              role="menuitem"
              onClick={() => {
                setMenu(false)
                o.run()
              }}
            >
              <span className="qc-opt-label">{o.label}</span>
              <span className="qc-opt-ico" style={{ ['--c' as string]: o.color }}>
                {o.icon}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        className={'qc-fab' + (menu ? ' open' : '')}
        aria-label={menu ? 'Close' : 'Quick add'}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => {
          haptic(10)
          setMenu((v) => !v)
        }}
      >
        {menu ? <CloseIcon /> : <ComposeIcon />}
      </button>

      {/* 新建内容首屏：选封面 emoji（或 Skip）→ 带 icon 进详情。与日历「+」共用 IconPickSheet。 */}
      {iconPickOpen && (
        <IconPickSheet onPick={(icon) => startContent(icon)} onClose={() => setIconPickOpen(false)} />
      )}

      {logOpen && (
        <LogEntrySheet
          projects={projects ?? []}
          demoMode={demoMode}
          onClose={() => setLogOpen(false)}
        />
      )}
    </>
  )
}
