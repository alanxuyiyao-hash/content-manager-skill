import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from 'react'
import { useSpring } from '@react-spring/web'
import { haptic } from '../lib/haptics'

export type SwipeAction = { label: string; color: string; icon?: ReactNode; onTrigger: () => void }

const BTN_W = 78 // 每个动作钮宽度
const DECIDE = 8 // 方向判定阈值（横/纵锁定）
const OPEN_RATIO = 0.4 // 松手时露出超过托盘 40% 即吸附打开
const RUBBER = 0.16 // 越界回弹阻尼（拉过开/合两端时的橡皮筋手感）
const PEEK = 26 // 首行「可左滑」提示：露出一小截动作色的位移
// 一次性 peek：本设备只在首次使用时,对首个挂载的行做一次极轻的「露一截又收回」暗示可左滑。
// 提示过记入 localStorage——原来是"每次会话一次",装成 PWA 后每次打开首卡都跳一下,
// 被当成 bug 报了(真机反馈);storage 不可用(隐私模式等)时退回会话内一次。
const PEEK_KEY = 'cm.swipePeekShown'
let peekShown = false
try {
  peekShown = localStorage.getItem(PEEK_KEY) === '1'
} catch {
  /* storage 不可用则保持 false,行为退化为每会话一次 */
}

/**
 * iOS Mail 式行内左滑：左滑露出右侧「动作托盘」并停住，点按钮才执行（不再滑过阈值即触发）。
 * 托盘按订单状态动态给出 [Start/Publish/Settle(绿)] [Delete(rose)] 等钮。
 *
 * 手势实现要点（修「长列表/ All 筛选下无法左滑」的根因）：
 * 触屏用「原生 touchmove（非 passive）+ 横向锁定后 preventDefault」驱动，绝不走 Pointer Events。
 * 因为当外层 .content 可纵向滚动时（订单多＝All 列表最长），Chromium 会在滑动中途抛 pointercancel
 * 抢走手势，导致 onPointerCancel 复位、整行无法左滑；短筛选列表不滚动才「碰巧能滑」。
 * 改由 touch 事件驱动 + 横向 preventDefault 后，浏览器不再抢滚动，touchmove 全程送达，任意列表长度都能滑。
 * 鼠标（桌面）走 Pointer Events（mouse 无此抢滚动问题）。touch-action: pan-y 保证纵向滚动不受影响。
 *
 * 跟手：拖动 1:1 跟随，越界带橡皮筋阻尼；松手弹性吸附到开/合两态；动作钮随拉出渐入 + 轻缩放；
 * 拉过阈值触发一次 haptic。未打开时 tap 正常进详情；托盘打开时 tap 行体只合上、不进详情；点外部自动合上。
 */
export default function SwipeRow({
  children,
  actions,
  className,
}: {
  children: ReactNode
  actions?: SwipeAction[]
  className?: string
}) {
  const acts = actions ?? []
  const trayW = acts.length * BTN_W
  const [dx, setDx] = useState(0) // 当前位移（负 = 左滑露出托盘）
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const startDx = useRef(0)
  const lock = useRef<0 | 1 | -1>(0) // 0 未定 / 1 横滑（本组件接管）/ -1 纵滑（交给页面滚动）
  const passed = useRef(false) // 本次拖动是否已越过开阈值（用于只触发一次 haptic）
  const dxRef = useRef(0)
  const swiped = useRef(false)
  const openRef = useRef(false) // 与 open 同步的镜像，供 touch 闭包读到最新值

  // react-spring 试水：只驱动「松手/自动」时的回弹（release）——物理弹簧替代原 CSS .anim 缓动，
  // 给 Tracck 那种带速度感的吸附手感。拖动仍是 1:1 直接 setDx，手势检测层（touch preventDefault /
  // 方向锁 / 抢滚动修复）完全不碰。onChange 每帧把弹簧值写回 dx，transform 照旧由 dx state 驱动。
  const [, spring] = useSpring(() => ({
    x: 0,
    config: { tension: 340, friction: 30 },
    onChange: (r) => {
      const v = r.value.x
      dxRef.current = v
      setDx(v)
    },
  }))
  // 从当前 dx 弹到目标位移。尊重 prefers-reduced-motion：减少动态时直接落位、不弹——
  // 且不依赖弹簧回调，直接写 dx + 同步弹簧内部值，保证该 a11y 路径下行永不卡住。
  const springTo = (to: number) => {
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      dxRef.current = to
      setDx(to)
      spring.set({ x: to })
      return
    }
    spring.start({ from: { x: dxRef.current }, x: to })
  }

  const close = () => {
    setOpen(false)
    openRef.current = false
    springTo(0)
  }
  const openTray = () => {
    // 双震修复：越阈已在 handleMove 预告过一次，松手吸附不再补震（一次手势只震一次）
    setOpen(true)
    openRef.current = true
    springTo(-trayW)
  }

  // 托盘打开时：点到本行以外（其它行 / 空白）自动合上，保证同时只有一行敞开。
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onDocDown, true)
    return () => window.removeEventListener('pointerdown', onDocDown, true)
  }, [open])

  // 越界橡皮筋：拉过 [-trayW, 0] 两端时按阻尼衰减，给到弹性手感
  const rubber = (raw: number) => {
    if (raw > 0) return raw * RUBBER
    if (raw < -trayW) return -trayW + (raw + trayW) * RUBBER
    return raw
  }

  const begin = (x: number, y: number) => {
    spring.stop() // 有回弹/peek 动画在飞则停下，交给本次拖动 1:1 接管
    startX.current = x
    startY.current = y
    startDx.current = openRef.current ? -trayW : 0
    lock.current = 0
    passed.current = false
    swiped.current = false // 新一次真实按下：清掉上次横滑遗留的吞 click 标记，保证 tap 立即生效
  }

  // 处理一次移动；返回 true 表示本组件已接管横滑（调用方应 preventDefault 阻止页面滚动/抢手势）
  const handleMove = (x: number, y: number): boolean => {
    if (!trayW) return false
    const ddx = x - startX.current
    const ddy = y - startY.current
    if (lock.current === 0) {
      if (Math.abs(ddx) < DECIDE && Math.abs(ddy) < DECIDE) return false
      lock.current = Math.abs(ddx) > Math.abs(ddy) ? 1 : -1
    }
    if (lock.current !== 1) return false // 纵滑：放手给页面滚动
    const v = rubber(startDx.current + ddx)
    dxRef.current = v
    setDx(v)
    const crossed = v <= -trayW * OPEN_RATIO
    if (crossed && !passed.current) {
      passed.current = true
      haptic(10) // 拉过阈值：一次轻震（吸附预告）
    } else if (!crossed && passed.current) {
      passed.current = false
    }
    return true
  }

  const endDrag = (swallowClick: boolean) => {
    if (lock.current !== 1) {
      lock.current = 0
      return
    }
    lock.current = 0
    if (swallowClick) {
      // 本次手势已被识别为横滑：吞掉紧随的 click，避免松手后误点行体进详情。
      // 若之后没有 click 跟来（触屏常见），400ms 后自愈复位。
      swiped.current = true
      window.setTimeout(() => {
        swiped.current = false
      }, 400)
    }
    // 松手吸附：露出超过托盘 40% 则打开并停住，否则合回
    if (dxRef.current <= -trayW * OPEN_RATIO) openTray()
    else close()
  }

  // 一次性 peek 提示（尊重 prefers-reduced-motion）：会话内首个带动作的行挂载后，
  // 轻露一截动作色再弹回，暗示「可左滑」。不改开合状态，用 react-spring 弹簧驱动。
  useEffect(() => {
    if (!trayW || peekShown) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    peekShown = true
    try {
      localStorage.setItem(PEEK_KEY, '1')
    } catch {
      /* 忽略:退化为每会话一次 */
    }
    const timers: number[] = []
    timers.push(
      window.setTimeout(() => {
        if (openRef.current) return // 期间用户已自行操作则不打断
        springTo(-PEEK)
        timers.push(
          window.setTimeout(() => {
            if (openRef.current) return
            springTo(0)
          }, 300),
        )
      }, 480),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [trayW])

  // handleMove 交给「非 passive 的原生 touchmove」调用（React 的 onTouchMove 是 passive，preventDefault 无效）。
  // 用 ref 转发，避免闭包读到旧的 trayW/state。
  const handleMoveRef = useRef(handleMove)
  handleMoveRef.current = handleMove
  useEffect(() => {
    const el = fgRef.current
    if (!el) return
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (handleMoveRef.current(t.clientX, t.clientY)) e.preventDefault()
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [])

  // 桌面鼠标：Pointer Events（仅 mouse；触屏走 touch 路径，避免双份处理）。
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !trayW) return
    begin(e.clientX, e.clientY)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 1) return
    // 只有判定为横向拖动后才捕获；按下即捕获会把普通 click 重定向到包装层，吞掉卡片点击。
    if (handleMove(e.clientX, e.clientY)) {
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    endDrag(true)
  }

  // 露出比例（0→1）：驱动动作钮渐入 + 轻缩放（CSS 用 var(--reveal)）
  const reveal = trayW ? Math.min(1, Math.abs(dx) / trayW) : 0

  return (
    <div ref={rootRef} className={'swipe-row' + (className ? ' ' + className : '')}>
      {trayW > 0 && (
        <div
          className="swipe-tray"
          style={{ width: trayW, ['--reveal' as string]: reveal } as CSSProperties}
          aria-hidden={!open}
        >
          {acts.map((a, i) => (
            <button
              key={i}
              type="button"
              className="swipe-act"
              style={{ background: a.color, width: BTN_W }}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                a.onTrigger()
                close()
              }}
            >
              {a.icon && <span className="swipe-act-ico" aria-hidden="true">{a.icon}</span>}
              <span className="swipe-act-label">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div
        ref={fgRef}
        className="swipe-fg"
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          if (!trayW || e.touches.length !== 1) return
          begin(e.touches[0].clientX, e.touches[0].clientY)
        }}
        onTouchEnd={() => endDrag(true)}
        onTouchCancel={() => endDrag(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          // 刚完成横滑：吞掉紧随的 click（含鼠标拖拽松手后浏览器补发的那一次），先于 open 判断，
          // 否则拖拽刚 openTray 就被这次 click 当成「点开着的行」立刻合上。begin() 会在下次真实按下清标记。
          if (swiped.current) {
            e.preventDefault()
            e.stopPropagation()
            swiped.current = false
            return
          }
          // 托盘敞开时点行体：只合上托盘，不进详情、不误触
          if (open) {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
