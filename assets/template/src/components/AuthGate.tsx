import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, readCachedSession } from '../lib/supabase'
import { startSync, stopSync } from '../lib/sync'
import './AuthGate.css'

const GET_SESSION_TIMEOUT_MS = 8000

// 登录门：未配置云同步 → 直接进入本地模式；已配置 → 登录后才渲染主应用并启动同步。
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    const finish = (s: Session | null) => {
      if (cancelled) return
      setSession(s)
      setReady(true)
    }
    // getSession 可能因 token refresh 请求 hang 而永不返回 → 超时回退本地缓存 session：
    // 有缓存就先进主应用用本地数据（refresh 成功后 onAuthStateChange 会带来真 session），
    // 没缓存则落登录页。
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), GET_SESSION_TIMEOUT_MS))
    Promise.race([supabase.auth.getSession().then(({ data }) => data.session), timeout])
      .then((s) => finish(s ?? readCachedSession()))
      .catch(() => finish(readCachedSession()))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  // 只随 user id 变化重启同步：TOKEN_REFRESHED 等事件换 token 不换人，不应重复整包拉取重建本地库
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (userId) void startSync()
    else stopSync()
  }, [userId])

  if (!isSupabaseConfigured) return <>{children}</>
  if (!ready)
    return (
      <div className="auth-screen">
        <div className="auth-card">Loading…</div>
      </div>
    )
  if (!session) return <LoginForm />
  return <>{children}</>
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Ledger</h1>
        <p className="auth-sub">Sign in to sync your data</p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {err && <p className="auth-err">{err}</p>}
        <button className="big-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
