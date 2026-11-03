/* Insights 粘贴解析：从平台后台复制的文本里提取 views/likes/favorites/followers。
 *
 * 设计原则：
 * - 只在「关键词 + 紧邻数字」匹配时填值，匹配不到的字段返回 undefined（绝不静默填错数据）。
 * - 支持中英文关键词、千分位逗号、万/亿 中文量级、k/m 后缀。
 * - 容错：多余的空格、换行、emoji 都不影响。
 *
 * 典型输入（小红书/B站/抖音后台复制）：
 *   "播放 5.2万  点赞 1,200  收藏 380  新增关注 64"
 *   "Views 52,000  Likes 1,200  Favorites 380  Followers gained 64"
 *   "播放量：83000\n点赞：2100\n收藏：450\n涨粉：120"
 */

export interface ParsedMetrics {
  views?: number
  likes?: number
  favorites?: number
  followersGained?: number
}

// 把中文量级 / k / m 后缀的数字串解析成纯数字。
//   "5.2万" → 52000, "1.2k" → 1200, "3m" → 3000000, "1,200" → 1200
function parseNumber(raw: string): number | null {
  const s = raw.replace(/[,，\s]/g, '').trim()
  if (!s) return null
  const m = /^(\d+(?:\.\d+)?)([万千亿km])?$/.exec(s)
  if (!m) return null
  const base = Number(m[1])
  if (!Number.isFinite(base)) return null
  const unit = m[2]
  // k/m 是千分位缩写（1.2k=1200）；万/亿 是中文量级
  const factor =
    unit === 'k' ? 1000 : unit === 'm' ? 1000000 : unit === '万' ? 10000 : unit === '亿' ? 100000000 : 1
  const n = Math.round(base * factor)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// 每个指标的关键词组（中英）。按特异性排序，匹配时取第一个命中的关键词后的数字。
const KEYWORDS: Record<keyof ParsedMetrics, string[]> = {
  // followers 要在 likes 之前试，避免 "关注" 被误匹配；用「涨粉/新增关注/followers gained」这类独占词
  followersGained: ['涨粉', '新增关注', '新增粉丝', '关注增量', 'followers gained', 'new followers', 'followers'],
  views: ['播放量', '播放', '阅读量', '阅读', '浏览量', '浏览', 'views', 'plays', 'impressions'],
  likes: ['点赞数', '点赞', '赞', 'likes', 'hearts'],
  favorites: ['收藏数', '收藏', 'saves', 'favorites', 'favourites', 'bookmarks'],
}

// 在文本里找「关键词 + 数字」对。返回该指标匹配到的数字（取最后一个命中，后台常把最新数放后面）。
function findMetric(text: string, words: string[]): number | undefined {
  let result: number | undefined
  for (const w of words) {
    // 关键词后允许：冒号、空格，然后是一个数字段。
    // 数字段 = 数字(含小数点、千分位逗号) 可选跟一个中文量级(万千亿)或英文缩写(km)；
    // 量级前可有一个空格（中文习惯 "12.5 万"）。数字段遇换行/其它中文即终止。
    const re = new RegExp(
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + // 转义关键词里的特殊字符
        '\\s*[:：]?\\s*' +
        '(\\d[\\d.,]*\\.?\\d*\\s?[万千亿km]?)',
      'gi',
    )
    const matches = [...text.matchAll(re)]
    for (const m of matches) {
      const n = parseNumber(m[1])
      if (n !== null) result = n // 取最后一个命中（最新值）
    }
  }
  return result
}

export function parseMetrics(text: string): ParsedMetrics {
  if (!text || !text.trim()) return {}
  const out: ParsedMetrics = {}
  for (const key of Object.keys(KEYWORDS) as (keyof ParsedMetrics)[]) {
    const v = findMetric(text, KEYWORDS[key])
    if (v !== undefined) out[key] = v
  }
  return out
}
