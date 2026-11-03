// 订单头像工具：按 id/name 稳定哈希 → 一组暖调低饱和色对（柔底 bg + 同色系较深字 fg）。
// 颜色 = 纯「身份色」：同一单永远同一色，只为一眼认出是哪单——不编码任何状态/收款语义
// （状态由胶囊表达、收款由胶囊角标点表达；曾经的 settled 褪灰会让人误读成"颜色=状态"，已移除）。
// 红线：绝不用语义色（lime/green/amber/rose）——那些留给状态/AD/付款标记；此处只出安静暖色。
// money.ts 零关联：纯展示工具。

export interface AvatarTone {
  bg: string
  fg: string
}

// 8 组暖调低饱和色对（clay / sage / mauve / sand / stone / slate-warm / taupe / blush-neutral）。
// 字色为同色系压深版，保证对比度。
const TONES: AvatarTone[] = [
  { bg: '#EFE0D8', fg: '#9a6a52' }, // clay
  { bg: '#E7EAE1', fg: '#6f7a62' }, // sage
  { bg: '#EEE3EA', fg: '#856a78' }, // mauve
  { bg: '#EFE8D6', fg: '#8a7a4e' }, // sand
  { bg: '#EAE7DF', fg: '#7d7566' }, // stone
  { bg: '#E5E8EB', fg: '#6b767e' }, // slate-warm
  { bg: '#EEE5DB', fg: '#8c7357' }, // taupe
  { bg: '#EEE4E2', fg: '#8a6f6a' }, // blush-neutral
]

// 稳定字符串哈希（djb-ish），保证同一 key 永远落到同一色对
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// 头像身份色：按 key 稳定取一组暖色（同一单永远同色）
export function avatarTone(key: string): AvatarTone {
  return TONES[hash(key || '·') % TONES.length]
}

// 分隔符集合：空白 / ASCII |、全角｜ / **汉字竖线"丨"(U+4E28，中文输入法常用作分隔，
// 其实是汉字部首、落在 CJK 区——之前被当成"首个汉字"返回，导致头像全是竖线，必须显式排除)** /
// 斜杠、点号、破折号、下划线等常见命名分隔。
const SEPARATORS = /[\s|｜丨\\/·・•‧．。，,：:；;–—\-_~〜#＃]+/

// 纯编号 token 判定：EP101 / A3 这类「1-3 字母 + 数字」的集数/编号前缀，跳过不取首字母。
const isSerialToken = (t: string): boolean => /^[A-Za-z]{1,3}\d+$/.test(t)

// 首个「有意义」字符：字母或汉字，但排除丨（已在分隔符里，这里双保险）
const MEANINGFUL = /[A-Za-z一-龥]/

// 修字母：不机械取 name[0]。按分隔符切词，跳过编号 token（EP101/0701/纯数字）后，
// 取第一个有意义词的首字母/首汉字。例："EP101 | Brand launch" → B、"0712 丨 三只松鼠" → 三。
export function avatarInitial(name: string | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return '·'
  const tokens = raw.split(SEPARATORS).filter(Boolean)
  for (const t of tokens) {
    if (isSerialToken(t)) continue // EP101 等集数前缀
    const m = t.match(MEANINGFUL) // 首个字母/汉字（丨 已被切掉）
    if (m) return m[0].toUpperCase()
  }
  // 兜底：全是编号/符号时，先剥掉分隔符再找字母/汉字，最后退到首个非分隔字符
  const stripped = raw.replace(new RegExp(SEPARATORS.source, 'g'), '')
  const any = stripped.match(MEANINGFUL)
  return (any ? any[0] : stripped[0] || '·').toUpperCase()
}

// 名牌短名：剥掉开头的编号/日期 token（EP101 / 0712 等）与分隔符，返回剩余有效名。
// 供"名字要塞进小空间"的场景（日历放大模式格内名牌等）；存储的全名不动。
// 例："0612 丨 三只松鼠礼盒" → "三只松鼠礼盒"、"EP101 | Brand launch" → "Brand launch"。
export function projectShortName(name: string | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  const tokens = raw.split(SEPARATORS).filter(Boolean)
  const keep: string[] = []
  for (const t of tokens) {
    // 只剥"开头连续"的编号/纯数字(含 0712/7.2 式日期)；一旦进入正文全部保留
    if (keep.length === 0 && (isSerialToken(t) || /^\d[\d.]*$/.test(t))) continue
    keep.push(t)
  }
  return keep.length ? keep.join(' ') : raw
}

// 新建订单入口首屏的常用品牌 emoji（快选）；详情面板同源，保证两处一致。
// 12 枚科技/AI/硬件测评向（本 App 主打 AI 模型·AI 工具·数码测评）：
//   AI=🤖🧠 · 电脑=💻🖥️ · 手机=📱 · 外设=⌨️🎧⌚📷🎮 · VR=🥽 · 工具=⚙️。
// 入口 6×2 整齐两行、单格 ≥44px 触控达标；详情 4 列面板整 3 行。
export const PROJECT_ICONS = [
  '🤖', '🧠', '💻', '🖥️', '📱', '⌨️',
  '🎧', '⌚', '📷', '🎮', '🥽', '⚙️',
]
