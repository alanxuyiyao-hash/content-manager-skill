// 通用细描边图标集（历史文件名 AppHeader，实际只导出图标——旧的 AppHeader 组件已退役、全站无人渲染）。
// 统一走 SVG，尺寸由容器 class 的 .gi 覆盖定（见 styles.css）。

export function ChevronLeft() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}
export function ChevronRight() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}
export function ChevronDown() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9l7 7 7-7" />
    </svg>
  )
}
// ✕/✓ 字形统一收口成 SVG（尺寸由容器 class 的 .gi 覆盖定，见 styles.css）
export function XIcon() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
export function CheckIcon() {
  return (
    <svg className="gi" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}
