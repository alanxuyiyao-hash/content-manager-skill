import type { SwipeAction } from '../components/SwipeRow'
import type { Project } from '../types'
import { stageOf } from '../types'
import { deleteProject, restoreProject, updateProject } from '../db'
import { isCommercialProject } from './money'
import { toast } from '../components/Toast'
import { haptic } from './haptics'

// 左滑动作钮图标（描边 SVG，与全站 .gi 同语言；swipe-act 内 currentColor=白）。
// 语义：Start=右箭头(开工) / Publish=上箭头(发布) / Mark paid=✓(收款) / Mark unpaid=↩(撤销) / Delete=垃圾桶。
const StartIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M12 6l6 6-6 6" />
  </svg>
)
const PublishIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 19V6M6 12l6-6 6 6" />
  </svg>
)
const PaidIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)
const DeleteIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)
// 记一笔（投流/广告支出）：¥ 符号（描边风，与 .gi 同语言）
const SpendIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 5l5 7 5-7M12 12v7M8.5 14.5h7M8.5 17.5h7" />
  </svg>
)
// Move = 改发布日（日历 glyph：左右箭头穿过日历，表示挪到另一天）
const MoveIcon = (
  <svg className="gi swipe-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 6h14M5 10h3M16 10h3M7 8l-2 2 2 2M17 8l2 2-2 2M8 16h8M12 14v6" />
  </svg>
)

// 订单行左滑「动作托盘」（首页 Projects + 日历 CalendarPage 共用）。
// 托盘随双轴状态给出动作（context-aware，生产阶段单步推进 + 收款切换），点按钮才执行——iOS Mail 式：
//   Planned(lead)        → [Start(绿)] [Move(灰,改/排期)] [Delete(rose)]
//   Producing(confirmed) → [Publish(绿)] [Move(灰)] [Delete]
//   Published 未收(published) → [Mark paid(绿)] [Log spend(amber)] [Delete]
//   Published 已收(settled)   → [Log spend(amber)] [Delete]
// 生产阶段单步前进（grey→amber→绿灰），收款轴在 Published 内 paid/unpaid 互切；绿钮=推进/切换、玫红=删除。
// Move 改/排期仅未发布(lead/confirmed)有：发布后日期是既成事实，改了会污染月度统计归月。
// 红线：零改动 money.ts / 计算口径——只走既有 updateProject / deleteProject / restoreProject。
// 乐观 UI：写库后 Dexie live query 自然回流；demo 模式只提示不落库（与 handleNew 一致）。
// onSettled?：可选展示层回调，结算成功后带订单 id 触发（首页结算爽点微动效）；不传即无副作用。
export function orderSwipeActions(
  p: Project,
  demoMode: boolean,
  onSettled?: (id: string) => void,
  onLog?: (p: Project) => void,
  onMove?: (p: Project) => void,
): SwipeAction[] {
  const actions: SwipeAction[] = []

  // 绿钮（双轴单步）：Planned→Start / Producing→Publish / Published 未收→Mark paid / Published 已收→Mark unpaid
  if (p.status === 'lead') {
    actions.push({
      label: 'Start',
      color: 'var(--good)',
      icon: StartIcon,
      onTrigger: () => {
        haptic(12)
        if (demoMode) {
          toast('Demo mode — changes are not saved')
          return
        }
        const prev = p.status
        void updateProject(p.id, { status: 'confirmed' })
        toast('Moved to producing', {
          actionLabel: 'Undo',
          onAction: () => void updateProject(p.id, { status: prev }),
        })
      },
    })
  } else if (p.status === 'confirmed') {
    actions.push({
      label: 'Publish',
      color: 'var(--good)',
      icon: PublishIcon,
      onTrigger: () => {
        haptic(12)
        if (demoMode) {
          toast('Demo mode — changes are not saved')
          return
        }
        const prev = p.status
        void updateProject(p.id, { status: 'published' })
        toast('Marked as published', {
          actionLabel: 'Undo',
          onAction: () => void updateProject(p.id, { status: prev }),
        })
      },
    })
  } else if (p.status === 'published' && isCommercialProject(p)) {
    // 收款轴仅商单有：自制内容 published 后无「Mark paid」步
    actions.push({
      label: 'Mark paid',
      color: 'var(--good)',
      icon: PaidIcon,
      onTrigger: () => {
        haptic(12)
        if (demoMode) {
          toast('Demo mode — changes are not saved')
          return
        }
        const prev = p.status
        void updateProject(p.id, { status: 'settled' })
        onSettled?.(p.id) // 收款爽点微动效（纯展示层回调，不影响写库/口径）
        toast('Marked as paid', {
          actionLabel: 'Undo',
          onAction: () => void updateProject(p.id, { status: prev }),
        })
      },
    })
  }
  // 已收款(settled)不再给「Mark unpaid」左滑：标错已收有 Undo toast + 详情页 Paid 开关兜底，
  // 日常已收款单只需 Log spend。已收款行左滑 = Log spend + Delete。

  // 记一笔（amber）：仅 Published 阶段（含已收 settled）才给——投流/广告费是给「已发布的内容」推流，
  // planned/producing 阶段还没发布、无处投流，不出现此动作。不写库，只开 LogEntrySheet 预选本项目。
  // 调用方传 onLog 才出现（首页/日历行传，其它场景可不传）。
  if (onLog && stageOf(p.status) === 'published') {
    actions.push({
      label: 'Log spend',
      color: 'var(--el-amber)',
      icon: SpendIcon,
      onTrigger: () => {
        haptic(12)
        onLog(p)
      },
    })
  }

  // 改期/排期（ink 中性）：仅未发布(lead/confirmed)单才有——发布后(published/settled)
  // 日期是既成事实，改了会污染月度统计（项目从原月消失跑到新月）。调用方传 onMove 才出现。
  // 无发布日的单点 Move = 排期（给个日期），有发布日 = 改期，预填由 date input 的 value 处理。
  if (onMove && (p.status === 'lead' || p.status === 'confirmed')) {
    actions.push({
      label: 'Move',
      color: 'var(--el-mut-strong)',
      icon: MoveIcon,
      onTrigger: () => {
        haptic(8)
        onMove(p)
      },
    })
  }

  // 删除（rose）：所有状态都有，复用既有 删除 + Undo toast 流程
  actions.push({
    label: 'Delete',
    color: 'var(--danger)',
    icon: DeleteIcon,
    onTrigger: () => {
      haptic(12)
      if (demoMode) {
        toast('Demo mode — changes are not saved')
        return
      }
      void deleteProject(p.id).then((snap) =>
        toast('Deleted', {
          actionLabel: 'Undo',
          onAction: () => snap && void restoreProject(snap),
        }),
      )
    },
  })

  return actions
}
