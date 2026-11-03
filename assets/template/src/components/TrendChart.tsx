import { useRef, useState, type PointerEvent } from 'react'
import { haptic } from '../lib/haptics'

// 共享交互折线图（与 Stats「Net · last 6 months」同款手写 SVG + 同套 net-trend-* 皮肤）：
// 指针横向 scrub → 就近点游标 + 跟随 popover 读数，每跨一个点 haptic(3) 出「震动」检点感，
// 轻点(<350ms & 位移<10px) → onPointOpen(该点 id)。几何(cx/cy/line)由调用方按各自数据算好传入，
// 组件只管交互与呈现，故 Stats/Insights/Year 复用同一交互与外观、不再各写一份。
export type TrendPoint = {
  id: string
  cx: number
  cy: number
  label: string // x 轴刻度（月份 / 日期）；传空串则不画该刻度
  value: number
  name: string // popover 标题（月名 / 内容名）
  showValue?: boolean // 是否常显该点数值（峰/谷/最新等）
  dim?: boolean // 淡显该点（如年视图未来月）
}

export function TrendChart({
  points,
  line,
  W,
  H,
  padTop,
  plotBot,
  format,
  ariaLabel,
  onPointOpen,
  refY,
  refLabel,
  zeroY,
  variant,
}: {
  points: TrendPoint[]
  line: string
  W: number
  H: number
  padTop: number // 游标竖线上端
  plotBot: number // 游标竖线下端
  format: (v: number) => string
  ariaLabel: string
  onPointOpen?: (id: string) => void
  refY?: number | null // 可选横向参考线的 y 坐标（如中位数）；复用 Stats 典型带虚线皮肤
  refLabel?: string // 参考线左端小标（如 MEDIAN）
  zeroY?: number | null // 可选零基线的 y 坐标（数据跨 0 时画一条虚线）
  variant?: 'net' | 'deal' // 线/点配色：net=绿(默认) / deal=琥珀
}) {
  const [idx, setIdx] = useState<number | null>(null)
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // 把指针横坐标映射到就近的数据点
  const pick = (clientX: number, rect: DOMRect): number => {
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    let bestD = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(p.cx - vx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }
  const scrub = (e: PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return
    const i = pick(e.clientX, e.currentTarget.getBoundingClientRect())
    if (i !== idx) {
      haptic(3)
      setIdx(i)
    }
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return
    downRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    scrub(e)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = downRef.current
    downRef.current = null
    setIdx(null)
    if (d && e.timeStamp - d.t < 350 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) {
      const i = pick(e.clientX, e.currentTarget.getBoundingClientRect())
      const id = points[i]?.id
      if (id) onPointOpen?.(id)
    }
  }
  const clear = () => {
    downRef.current = null
    setIdx(null)
  }
  const active = idx !== null ? points[idx] : null
  const last = points.length - 1
  const dealCls = variant === 'deal' ? ' deal' : ''

  return (
    <div className="net-trend-plot">
        <svg
          className="net-trend-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          onPointerDown={onDown}
          onPointerMove={scrub}
          onPointerUp={onUp}
          onPointerLeave={clear}
          onPointerCancel={clear}
        >
          {/* 零基线（数据跨 0 时）画在最底层 */}
          {zeroY != null && <line className="net-trend-zero" x1={10} x2={W - 10} y1={zeroY} y2={zeroY} />}
          {/* 横向参考线（如中位数）：横虚线 + 左端小标，与 Stats 典型带同款皮肤 */}
          {refY != null && (
            <>
              <line className="net-trend-band-edge" x1={10} x2={W - 10} y1={refY} y2={refY} />
              {refLabel && (
                <text className="net-trend-band-label" x={14} y={Math.max(8, refY - 4)}>
                  {refLabel}
                </text>
              )}
            </>
          )}
          {points.length > 1 && <polyline className={'net-trend-line' + dealCls} points={line} />}
          {active && (
            <line className="net-trend-cursor" x1={active.cx} x2={active.cx} y1={padTop} y2={plotBot} />
          )}
          {points.map((p, i) => (
            <circle
              key={p.id}
              className={
                'net-trend-dot' + dealCls + (p.dim ? ' dim' : '') + (i === last ? ' last' : '') + (i === idx ? ' active' : '')
              }
              cx={p.cx}
              cy={p.cy}
              r={i === idx ? 4.5 : i === last ? 4 : 2.6}
            />
          ))}
          {points.map((p) =>
            p.label ? (
              <text key={'l' + p.id} className="net-trend-label" x={p.cx} y={H - 5}>
                {p.label}
              </text>
            ) : null,
          )}
          {/* 关键点数值常显（拖动时让位给 popover 读数） */}
          {!active &&
            points
              .filter((p) => p.showValue)
              .map((p) => (
                <text
                  key={'v' + p.id}
                  className={'net-trend-val' + dealCls}
                  x={Math.min(Math.max(p.cx, 22), W - 22)}
                  y={Math.max(10, p.cy - 7)}
                  textAnchor={p.cx < 42 ? 'start' : p.cx > W - 42 ? 'end' : 'middle'}
                >
                  {format(p.value)}
                </text>
              ))}
        </svg>
        {active && (
          <div
            className="net-trend-pop"
            style={{ left: `${Math.min(Math.max((active.cx / W) * 100, 14), 86)}%` }}
            role="status"
          >
            <span className="net-trend-pop-name">{active.name}</span>
            <b>{format(active.value)}</b>
          </div>
        )}
    </div>
  )
}
