// 轻量触觉反馈 haptic()：克制使用——只在筛选 / 进详情 / 新建 / 滑动推进 / 结算这类明确操作
// 上给一次极短脉冲。签名保持兼容（各处已 haptic(ms) 调用），本轮只升级内部实现。
//
// 双通道（互不冲突，同一设备只有一路真正生效）：
//   1) Android / 支持 Vibration API 的浏览器 → navigator.vibrate(ms) 直接生效。
//   2) iOS Safari 与安装到桌面的 PWA → navigator.vibrate 被系统完全忽略（这正是 iPhone
//      一直没有震感、与原生 App 拉开体验差距的根因）。iOS 17.4+ 起 <input type="checkbox"
//      switch> 会渲染成原生开关，程序化 toggle 它可骗过系统触发一次轻微的系统级触觉。这里
//      内联实现该技巧（思路参考 ios-haptics 库，不引入依赖）：懒创建一个隐藏 label+switch
//      挂到 body，绝对定位移出版面、opacity:0 不可见、pointer-events:none 不吃点击，
//      haptic() 时 label.click() 触发一次开关切换。
//
// 诚实提示：Apple 已在 iOS 26.5 修补此技巧，最新 iOS 可能不再触发；届时静默降级、无任何
// 副作用（不抛错、不留可见元素）。全程 try/catch，不支持一律安静忽略。

// 懒创建一次并复用的隐藏 switch（仅浏览器环境创建；创建失败则返回 null 静默降级）。
let switchLabel: HTMLLabelElement | null = null

function getSwitchLabel(): HTMLLabelElement | null {
  if (switchLabel) return switchLabel
  if (typeof document === 'undefined' || !document.body) return null

  const label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  // 去外观：绝对定位 + 0 尺寸不占版面、overflow:hidden + opacity:0 不可见、pointer-events:none
  // 不吃点击。刻意用 opacity 而非 display:none（元素需留在渲染树里，新版 iOS 才会触发触觉），
  // 且不改 input 的 appearance——保留其「原生 iOS 开关」渲染，toggle 才会引发系统触觉。
  label.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '') // iOS 17.4+ 原生开关；toggle 时系统给一次轻触觉
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')

  label.appendChild(input)
  document.body.appendChild(label)
  switchLabel = label
  return label
}

// 轻脉冲；ms 仅对 Android 的 vibrate 有意义（iOS 走 switch 技巧，时长由系统决定）。
export function haptic(ms = 8): void {
  // 通道 1：Android / 支持 Vibration API 者（iOS 上此分支恒为假，天然跳过、不会双震）。
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(ms)
    }
  } catch {
    /* 权限 / 不支持：安静忽略 */
  }

  // 通道 2：iOS Safari/PWA 的隐藏 switch toggle（其它平台仅切换一个不可见复选框，无副作用）。
  // click() 会让隐藏 checkbox 获得原生焦点、把当前焦点顶掉——键盘/读屏用户每次触发 haptic
  // 后焦点都会丢、弹层初始焦点管理形同虚设。故 click 前后记录并还原 activeElement（ix-1）。
  // 性能优化：只有真实可编辑控件（input/textarea/select/contenteditable）在焦点时才做还原。
  // 拖动折线 / 左滑卡片这类手势里通常没有输入框聚焦（activeElement 是 body/SVG），此时跳过
  // focus(preventScroll)——免掉每个检点都触发一次焦点+布局开销，scrub/滑动更跟手（震感不变）。
  try {
    const active = document.activeElement as HTMLElement | null
    const prev =
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable)
        ? active
        : null
    getSwitchLabel()?.click()
    if (prev && prev !== document.activeElement && typeof prev.focus === 'function') {
      prev.focus({ preventScroll: true })
    }
  } catch {
    /* 不支持 / 已被系统修补：安静忽略 */
  }
}
