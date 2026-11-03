import Sheet from './Sheet'
import { PROJECT_ICONS } from '../lib/avatar'
import { haptic } from '../lib/haptics'

/**
 * 新建内容首屏：先选个封面 emoji 头像（或 Skip 用色底默认），再进详情。
 * 全局 FAB（QuickCapture）与日历「+」共用同一套，保证两处添加流程一致。
 * onPick(icon?) —— 选中某枚 emoji 或 Skip（icon 为 undefined）时触发，调用方负责关面板 + 开详情。
 */
export default function IconPickSheet({
  onPick,
  onClose,
}: {
  onPick: (icon?: string) => void
  onClose: () => void
}) {
  return (
    <Sheet title="New content" className="sheet-compact" onClose={onClose} leftActionLabel="Cancel">
      <div className="qi">
        <p className="qi-hint">Pick a cover — or skip, we'll use a soft color badge.</p>
        <div className="qi-grid" role="listbox" aria-label="Content icon">
          {PROJECT_ICONS.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={false}
              className="qi-opt"
              onClick={() => {
                haptic(8)
                onPick(e)
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="qi-skip"
          onClick={() => {
            haptic(8)
            onPick()
          }}
        >
          Skip
        </button>
      </div>
    </Sheet>
  )
}
