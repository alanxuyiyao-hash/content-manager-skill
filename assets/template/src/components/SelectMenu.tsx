import { useState } from 'react'
import { CheckIcon, ChevronDown } from './AppHeader'

export type SelectOption = { value: string; label: string; color?: string }

/**
 * 自定义下拉（非原生 select）：与 ProjectDetail 的 Status 下拉同款视觉——
 * 复用 .pd-stage-* 下拉卡 + 项样式，触发器落在 .finance-field 行内展示当前值 + 细描边 chevron，
 * 点开在下方浮出选项卡（选中项高亮 + ✓）。原生 <select> 与本 App 精致审美不一，故统一替换。
 */
export default function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select',
  menuPlacement = 'bottom',
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  placeholder?: string
  menuPlacement?: 'bottom' | 'inline'
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className={'pd-stage-wrap qe-select qe-select-' + menuPlacement}>
      <button
        type="button"
        className={'qe-project' + (open ? ' pd-stage open' : ' pd-stage')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {current ? current.label : placeholder}
        <span className="pd-stage-chev" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <>
          <div className="pd-stage-mask" onClick={() => setOpen(false)} />
          <div className="pd-stage-menu" role="listbox" aria-label={ariaLabel}>
            {options.map((o) => {
              const on = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={'pd-stage-item' + (on ? ' on' : '')}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.color && <i className="pd-stage-item-dot" style={{ background: o.color }} />}
                  <span className="pd-stage-item-label">{o.label}</span>
                  {on && (
                    <span className="pd-stage-check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
