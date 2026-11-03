import { useState } from 'react'
import type { AdSpendGoal, AdSpendRecord, Project } from '../types'
import { AD_SPEND_GOALS, AD_SPEND_GOAL_LABELS } from '../types'
import { db, genId, updateProject } from '../db'
import { todayKey } from '../lib/date'
import Sheet from './Sheet'
import SelectMenu from './SelectMenu'
import { toast } from './Toast'

/**
 * Log ad spend: 快速给所选内容补一笔投放记录（目标 + 金额，追加进 adSpends 逐笔历史）。
 * 无商单时不该被打开（调用方兜底）；这里仍对 projects 为空做防御。
 */

export default function LogEntrySheet({
  projects,
  demoMode = false,
  defaultProjectId,
  onClose,
}: {
  projects: Project[]
  demoMode?: boolean
  defaultProjectId?: string
  onClose: () => void
}) {
  // 挂靠候选：按最近更新排序，默认选最近的一个（或调用方指定）
  const projectsByRecency = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  const [initial] = useState(() => ({
    amount: '',
    projId: defaultProjectId ?? projectsByRecency[0]?.id ?? '',
    goal: 'engagement' as AdSpendGoal,
  }))
  const [amount, setAmount] = useState(initial.amount)
  const [projId, setProjId] = useState<string>(initial.projId)
  const [goal, setGoal] = useState<AdSpendGoal>(initial.goal)
  const dirty = amount !== initial.amount || projId !== initial.projId || goal !== initial.goal

  const save = async () => {
    if (demoMode) {
      toast('Demo mode — changes are not saved')
      onClose()
      return
    }
    const amt = Math.max(0, Number(amount.trim().replace(/[,¥\s]/g, '')) || 0)
    if (!amount.trim() || amt <= 0) {
      toast('Enter a valid amount')
      return
    }
    const proj = projects.find((p) => p.id === projId)
    if (!proj) {
      toast('Pick a project first')
      return
    }
    // ad spend 现为逐笔记录：追加一条（旧 adSpend 单值/旧 expense 流水不动，
    // 总额契约三者相加不会漏计；一次性迁移留给项目详情页打开时做）。
    const rec: AdSpendRecord = { id: genId('as'), goal, amount: amt, date: todayKey() }
    await updateProject(proj.id, { adSpends: [...(proj.adSpends ?? []), rec] })
    toast('Ad spend added', {
      actionLabel: 'Undo',
      onAction: () => {
        void db.projects.get(proj.id).then((latest) => {
          if (!latest) return
          // 反向移除这条记录（按 id 精确撤销，不动其他记录）
          void updateProject(proj.id, { adSpends: (latest.adSpends ?? []).filter((r) => r.id !== rec.id) })
        })
      },
    })
    onClose()
  }

  return (
      <Sheet
        title="Log ad spend"
        className="spend-sheet sheet-top"
        onClose={onClose}
        leftActionLabel="Cancel"
        primaryLabel="Done"
        onPrimary={save}
        primaryDisabled={!amount.trim() || !projId}
        confirmOnClose={dirty}
      >
        <div className="pd">
          <section className="pd-card">
            <div className="pd-fields">
              <label className="finance-field">
                <span>Amount</span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                />
              </label>
            </div>

            {/* 投放目标：互动 / 粉丝 / 阅读量（与 Insights 指标英文同一套词） */}
            <div className="finance-field spend-goal-field">
              <span>Goal</span>
              <div className="td-chips expense" role="radiogroup" aria-label="Ad goal">
                {AD_SPEND_GOALS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={goal === g}
                    className={'td-chip' + (goal === g ? ' on' : '')}
                    onClick={() => setGoal(g)}
                  >
                    {AD_SPEND_GOAL_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>

            <div className="finance-field">
              <span>Project</span>
              <SelectMenu
                ariaLabel="Project"
                value={projId}
                onChange={setProjId}
                options={projectsByRecency.map((p) => ({ value: p.id, label: p.name || 'Untitled' }))}
                menuPlacement="inline"
              />
            </div>
          </section>
        </div>
      </Sheet>
  )
}
