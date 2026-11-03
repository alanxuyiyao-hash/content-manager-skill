/* ===================== 项目 / 商单 ===================== */

export type ProjectStatus = 'lead' | 'confirmed' | 'published' | 'settled'

// 商单四阶段展示（全站统一）：底层枚举 lead/confirmed/published/settled 不变，仅改展示分档 label/色。
// 配色进阶 grey→amber→rose→green：Planned(中性 stone 暖灰) → Producing(amber) → Published(rose) → Settled(green)。
// 纯展示色/文案，不影响任何金额/状态判定。
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; color: string }> = {
  lead: { label: 'Planned', color: '#8a8578' }, // 中性 stone 暖灰：未开始（勿用 amber）
  confirmed: { label: 'Producing', color: '#b5791a' }, // amber：制作中
  published: { label: 'Published', color: '#c0564d' }, // rose：已发布待回款，与 settled(green) 区分
  settled: { label: 'Settled', color: '#2c7a4e' }, // green：已结算
}

export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['lead', 'confirmed', 'published', 'settled']

/* ---- 双轴状态模型（首页 / 日历展示层）----
   底层枚举 lead/confirmed/published/settled 不变；展示层拆成两条正交轴：
   · 生产阶段 stage：lead→planned / confirmed→producing / published|settled→published
   · 付款 paid：仅 settled 为已收（isPaid）。published=已发未收(Unpaid)、settled=已发已收(Paid)。
   首页/日历只展示三阶段(Planned/Producing/Published)，「是否收款」降为 Published 行内小标记。
   付款大盘（应收/settled）仍归 Stats，不在此展示。纯展示派生，不影响任何金额/状态判定。 */
export type ProjectStage = 'planned' | 'producing' | 'published'

export const stageOf = (s: ProjectStatus): ProjectStage =>
  s === 'lead' ? 'planned' : s === 'confirmed' ? 'producing' : 'published'

export const isPaid = (s: ProjectStatus): boolean => s === 'settled'

// 三阶段展示 meta（label/色）：Planned(中性 stone 暖灰) → Producing(amber) → Published(沉静绿灰)。
// Published 的沉静绿灰明确区别于 Overdue 玫红；收款状态另由行内 Received / Awaiting 标记表达。
export const PROJECT_STAGE_META: Record<ProjectStage, { label: string; color: string }> = {
  planned: { label: 'Planned', color: '#6f6a5c' }, // 中性 stone 暖灰：未开始（=--el-stone，与首页胶囊同深浅）
  producing: { label: 'Producing', color: '#b5791a' }, // amber：制作中（=--el-amber）
  published: { label: 'Published', color: '#4f6b58' }, // 沉静绿灰：已发布（=--el-pub；收款见行内标记）
}

export const PROJECT_STAGE_ORDER: ProjectStage[] = ['planned', 'producing', 'published']

export type EntryType = 'income' | 'expense'

/* ---- 投放（ad spend）逐笔记录 ----
   投放目标三类型，内部值与 Insights 指标英文一致（views/engagement/followers）：
   「投了什么目标」和「看什么数据」用同一套词，后续可按目标对照数据表现。
   历史数据（旧 adSpend 单值/旧 expense 流水）无目标信息，迁移时统一按 engagement（互动）。 */
export type AdSpendGoal = 'engagement' | 'followers' | 'views'

export const AD_SPEND_GOALS: AdSpendGoal[] = ['engagement', 'followers', 'views']

export const AD_SPEND_GOAL_LABELS: Record<AdSpendGoal, string> = {
  engagement: 'Engagement', // 互动（likes + favorites 口径，与 Insights 同）
  followers: 'Followers', // 粉丝（followersGained）
  views: 'Views', // 阅读量（views）
}

export interface AdSpendRecord {
  id: string
  goal: AdSpendGoal // 投放目标：互动 / 粉丝 / 阅读量
  amount: number // 元，正数
  date?: string // YYYY-MM-DD 这笔投放日（可选）
  note?: string
}

export interface LedgerEntry {
  id: string
  type: EntryType // 收入 / 支出
  category?: string // 商单 / 投流 / 道具 …
  amount: number // 元，正数
  date?: string // YYYY-MM-DD 这笔实际收/付款日（可选）
  note?: string
}

// 固定支出 / 经营开销：不挂任何项目的支出（税务、房租…），按月手动记，独立存储。
// 用 date(YYYY-MM-DD) 归月，和项目同口径并入 Data 的成本与净利。
export interface Overhead {
  id: string
  date: string // YYYY-MM-DD 归月依据
  category: string // 科目：税务 / 自定义
  amount: number // 元，正数
  note?: string
  updatedAt?: number // 同步冲突裁决；旧数据缺省时按 0 处理
}

// 固定支出的预置科目（可自由填写其它）。UI 全英文，故内部值直接用英文，免标签映射。
// 增值税 / 个人所得税 / 公司运营成本 / 其他；旧数据里的 'Tax' 经 catLabel 透传为自定义文本，仍可读。
export const OVERHEAD_CATEGORIES = ['VAT', 'Income Tax', 'Operating Cost', 'Other']

export interface Project {
  id: string
  name: string // 商单名 / 品牌
  icon?: string // 可选品牌 emoji 头像（未索引可选字段，订单卡优先显示，回退首字母）
  status: ProjectStatus // 商务/结款状态（管钱）
  isCommercial?: boolean // 是否商业合作广告；旧数据未填时按收入明细兜底
  adQuote?: number // 广告报价，返点前
  rebateRate?: number // 返点比例，0-100
  adSpend?: number // 旧·投放费用单值（遗留字段）：打开详情时一次性迁移进 adSpends；未迁移数据仍参与总额合计
  adSpends?: AdSpendRecord[] // 投放逐笔历史（分次投放，每笔带目标/日期）；对外展示总额 = projectAdSpend 合计
  views?: number // 可选播放量：商单/自制内容通用（自制内容并入后从 Post 迁来）
  likes?: number // 可选点赞数（发布后内容表现，Insights 页录入）
  favorites?: number // 可选收藏数
  followersGained?: number // 可选涨粉数（单条笔记带来的新增关注，Insights 页核心指标）
  statsUpdatedAt?: number // 内容数据(views/likes/favorites/followersGained)最近录入时间——数据时变，录入时点决定「n 天前的数」语义；与 updatedAt（sync 合并裁决位）无关
  publishDate?: string // 发布/排期日：月度统计归月依据
  startDate?: string // 时间线起
  endDate?: string // 时间线止
  releaseDeadline?: string // 发布 deadline（权威发布日，月度归月口径）
  entries: LedgerEntry[] // 多笔收支
  note: string
  review?: string // 发布后复盘：数据 / 经验 / 下次改进
  createdAt: number
  updatedAt: number
}

export const INCOME_CATEGORIES = ['商单', '平台分成', '其他收入']
export const EXPENSE_CATEGORIES = ['投流/广告']

// 分类内部值保留中文（与 money.ts 判定、旧数据兼容），仅展示用英文标签
export const CATEGORY_LABELS: Record<string, string> = {
  商单: 'Sponsorship',
  平台分成: 'Platform share',
  其他收入: 'Other income',
  '投流/广告': 'Ad spend',
  '道具/物料': 'Props / materials',
  外包: 'Outsourcing',
  其他支出: 'Other cost', // 展示层同词化：与详情合计行/财务条的 Cost 用同一个词（内部值不变）
}
export const catLabel = (value: string): string => CATEGORY_LABELS[value] ?? value
