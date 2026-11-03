import { useState } from 'react'
import { format } from 'date-fns'
import type { Project } from '../types'
import { updateProject } from '../db'
import { projectReleaseDay } from '../lib/projectSchedule'
import { fromKey } from '../lib/date'
import { toast } from '../components/Toast'
import { haptic } from '../lib/haptics'
import DatePicker from '../components/DatePicker'

/**
 * 左滑「Move」改期/排期的共享逻辑（首页 + 日历共用）。
 *
 * 仅语义上对「未发布(lead/confirmed)」单才有意义——发布后日期是既成事实，
 * 改了会污染月度统计归月。是否出现 Move 钮由 orderSwipeActions 按 status 控制，
 * 本 hook 只负责：弹出 App 自定义 DatePicker（与详情页选发布日同一套 UI，不再用系统日期滚轮）
 * → 写三字段镜像(releaseDeadline/endDate/publishDate，口径同详情页) → toast + Undo。
 *
 * 用法：
 *   const resched = useReschedule(demoMode)
 *   // 左滑动作：orderSwipeActions(..., resched.requestMove)
 *   // JSX：{resched.movePicker}   // 打开时渲染底部日历，否则 null
 */
export function useReschedule(demoMode: boolean, onMoved?: (next: string) => void) {
  const [moveProject, setMoveProject] = useState<Project | null>(null)

  // 左滑 Move 触发：记录项目 → movePicker 随之渲染出 DatePicker
  const requestMove = (p: Project) => setMoveProject(p)

  // 选完日期：写三字段镜像 + toast Undo；onMoved 让调用方跟随跳月（日历用）
  const onMoveDate = (next: string) => {
    const pp = moveProject
    setMoveProject(null)
    if (!pp || !next) return
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      return
    }
    const prev = projectReleaseDay(pp)
    void updateProject(pp.id, { releaseDeadline: next, endDate: next, publishDate: next })
    toast(`Moved to ${format(fromKey(next), 'MMM d')}`, {
      actionLabel: 'Undo',
      onAction: () =>
        prev
          ? void updateProject(pp.id, { releaseDeadline: prev, endDate: prev, publishDate: prev })
          : void updateProject(pp.id, {
              releaseDeadline: undefined,
              endDate: undefined,
              publishDate: undefined,
            }),
    })
    haptic(8)
    onMoved?.(next)
  }

  // 与详情页选发布日同一套 DatePicker（底部日历）：全站改期 UI 统一，不再各自弹系统滚轮
  const movePicker = moveProject ? (
    <DatePicker
      value={projectReleaseDay(moveProject) ?? undefined}
      onPick={onMoveDate}
      onClose={() => setMoveProject(null)}
    />
  ) : null

  return { requestMove, moveProject, movePicker }
}
