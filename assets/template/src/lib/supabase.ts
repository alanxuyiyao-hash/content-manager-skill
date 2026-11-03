import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

// 云同步配置来自构建期环境变量（本地放 .env.local，线上放 Cloudflare Pages 环境变量）。
// anon key 设计上可公开，真正的数据保护靠 Supabase 的 RLS + 登录。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// 没配 env 时 = 本地模式：应用照常用本地 IndexedDB，不出现登录门、不做云同步。
export const isSupabaseConfigured = Boolean(url && anonKey)

// 全局网络超时：没有它，hang 住的请求（如 token refresh）会让 getSession/pull 永久挂起。
const FETCH_TIMEOUT_MS = 15000
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), FETCH_TIMEOUT_MS)
  init?.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// 未配置时给一个占位 client，保证 import 阶段不崩；所有调用处都用 isSupabaseConfigured 守卫。
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
)

// getSession 超时兜底：直接读 supabase-js v2 的 localStorage 键（best-effort，依赖其内部存储格式；
// 解析失败返回 null → 回退登录页，不影响正确性）。离线/网络差时让用户先进本地数据。
export function readCachedSession(): Session | null {
  if (!url) return null
  try {
    const ref = new URL(url).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session | null
    return parsed?.user ? parsed : null
  } catch {
    return null
  }
}
