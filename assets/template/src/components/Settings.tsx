import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getProfile, setProfile } from '../db'
import { exportData, importData } from '../lib/backup'
import { saveBackupJSON } from '../lib/backupFile'
import { runBackupExportOnce } from '../lib/backupExportLock'
import { fileToAvatar } from '../lib/image'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { onSyncStatus, pushRemote, flushSync, type SyncStatus } from '../lib/sync'
import { usePrivacy } from '../lib/privacy'
import { CURRENCIES, useCurrency } from '../lib/currency'
import { notificationPermission, notificationsSupported, useReminders } from '../lib/reminders'
import { haptic } from '../lib/haptics'
import { CheckIcon } from './AppHeader'
import ConfirmDialog from './ConfirmDialog'
import { PersonIcon } from './MeAvatar'
import { toast } from './Toast'

// 全站同款 chevron（与 AppHeader 的 ChevronRight 同 path/同 2.2 描边）
const Chevron = (
  <svg className="me-row-chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
)

// 存储量可读化：Chrome 配额常为 20 万+ MB，≥1GB 换 GB 单位（"240 GB" 而非 "245760 MB"）
const fmtStorage = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb.toFixed(0)} MB`)

// 同步错误展示兜底：supabase 冒泡上来的原始 message 可能为空、含中文或非标准串，
// 统一收敛成可读英文，避免把中文/无意义串直接甩给英文用户。
const CJK = /[一-鿿]/
function syncErrorLabel(message?: string): string {
  const m = message?.trim()
  if (!m || CJK.test(m)) return 'Sync error: something went wrong — please try again'
  return `Sync error: ${m}`
}

// 规整 grouped-list 行：左图标 + 标题/副文 + 右控件（值 / chevron / 开关）。
// 命中区 ≥52px 高，满足 a11y；可点行走 button（带 haptic），静态行走 div。
function Row({
  icon,
  title,
  sub,
  tail,
  onClick,
  danger,
  disabled,
}: {
  icon: ReactNode
  title: string
  sub?: ReactNode
  tail?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  const cls = 'me-row' + (onClick ? ' tap' : '') + (danger ? ' danger' : '')
  const inner = (
    <>
      <span className="me-row-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="me-row-main">
        <span className="me-row-title">{title}</span>
        {sub != null && sub !== '' && <span className="me-row-sub">{sub}</span>}
      </span>
      {tail != null && <span className="me-row-tail">{tail}</span>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        disabled={disabled}
        onClick={() => {
          haptic(8)
          onClick()
        }}
      >
        {inner}
      </button>
    )
  }
  return <div className={cls}>{inner}</div>
}

function SwitchRow({
  icon,
  title,
  sub,
  on,
  onClick,
}: {
  icon: ReactNode
  title: string
  sub?: ReactNode
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="me-row me-row-switch tap"
      role="switch"
      aria-checked={on}
      onClick={() => {
        haptic(8)
        onClick()
      }}
    >
      <span className="me-row-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="me-row-main">
        <span className="me-row-title">{title}</span>
        {sub != null && sub !== '' && <span className="me-row-sub">{sub}</span>}
      </span>
      <span className="me-row-tail">
        <span className={'me-toggle-switch' + (on ? ' on' : '')} aria-hidden="true">
          <i />
        </span>
      </span>
    </button>
  )
}

// 「我的」页退回纯 Settings：保留资料编辑、隐私偏好、同步/备份，不再混入数据回总。
// 第 4 个常驻页（.me-page）：不再是「点 tab 弹出要 Close 才能退的浮层」，tab 直接切到本页，
// 切走只需点别的 tab；复用 .el-page 皮肤 + .el-sheet 的 me-* 内容样式。
export default function Settings() {
  const exportLock = useRef(false)
  const [exporting, setExporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  const { hideMoney, toggleHideMoney } = usePrivacy()
  const { remindersOn, toggleReminders } = useReminders()
  const { currency, setCurrency } = useCurrency()
  const [curOpen, setCurOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [askSignOut, setAskSignOut] = useState(false)
  const [sync, setSync] = useState<SyncStatus>({ state: 'disabled', lastSyncedAt: null })
  useEffect(() => onSyncStatus(setSync), [])
  // 存储用量预警：图片以 base64 存 IndexedDB，量大时可能逼近 Safari 配额被静默驱逐
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number; pct: number } | null>(null)
  useEffect(() => {
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then((e) => {
        const used = e.usage ?? 0
        const quota = e.quota ?? 0
        if (quota > 0) setStorage({ usedMB: used / 1048576, quotaMB: quota / 1048576, pct: (used / quota) * 100 })
      })
    }
  }, [])

  // 名字/简介本地编辑、随键持久化；头像走 liveQuery 实时反映
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  useEffect(() => {
    getProfile().then((p) => {
      setName(p.name ?? '')
      setBio(p.bio ?? '')
    })
  }, [])
  const avatar = useLiveQuery(async () => (await getProfile()).avatar, [], undefined as string | undefined)

  const syncLabel =
    sync.state === 'syncing'
      ? 'Syncing…'
      : sync.state === 'error'
        ? syncErrorLabel(sync.message)
        : sync.lastSyncedAt
          ? // 锁 en-US 短格式：全站 UI 英文，不随设备 locale；带秒的全量串太长
            `Synced · ${new Date(sync.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
          : 'Not synced yet (auto-uploads ~3s after changes)'

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const avatar = await fileToAvatar(file)
      await setProfile({ avatar })
      toast('Avatar updated')
    } catch (err) {
      toast('Image processing failed')
      console.error(err)
    }
  }

  const doExport = () =>
    runBackupExportOnce(exportLock, async () => {
      setExporting(true)
      setMsg('')
      try {
        const data = await exportData()
        const stamp = new Date().toISOString().slice(0, 10)
        const result = await saveBackupJSON(data, `content-manager-backup-${stamp}.json`)
        if (result === 'canceled') return
        setMsg(`Exported ${data.projects.length} orders, ${data.overheads?.length ?? 0} expenses`)
        toast('Backup exported')
      } catch (err) {
        setMsg('Export failed: ' + (err as Error).message)
        toast('Export failed')
      } finally {
        setExporting(false)
      }
    })

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const r = await importData(text, 'merge')
      setMsg(`Imported ${r.projects} orders, ${r.overheads} expenses`)
      toast('Imported')
    } catch (err) {
      setMsg('Import failed: ' + (err as Error).message)
      toast('Import failed')
    } finally {
      e.target.value = ''
    }
  }

  const doSignOut = async () => {
    // 登出会终止会话，先把待推送内容刷完再退，否则防抖窗口里的改动会丢
    try {
      await flushSync()
    } catch {
      toast('Sync failed — still signed in')
      return
    }
    void supabase.auth.signOut()
  }

  return (
    <>
    <div className="page el-page el-sheet me-page">
      <header className="he-top">
        <h1 className="he-month">
          <span className="he-mtext">Settings</span>
        </h1>
      </header>

        <div className="section-label">Profile</div>
        <div className="me-profile-card">
          <button
            type="button"
            className="me-avatar-btn"
            onClick={() => avatarRef.current?.click()}
            aria-label="Change avatar"
          >
            {avatar ? (
              <img src={avatar} alt="" />
            ) : (
              <span className="me-avatar-fallback">
                <PersonIcon />
              </span>
            )}
          </button>
          <input ref={avatarRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
          <div className="me-profile-fields">
            <input
              className="me-name"
              placeholder="Your name"
              aria-label="Your name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                void setProfile({ name: e.target.value })
              }}
            />
            <input
              className="me-bio"
              placeholder="One line about you"
              aria-label="One line about you"
              value={bio}
              onChange={(e) => {
                setBio(e.target.value)
                void setProfile({ bio: e.target.value })
              }}
            />
          </div>
        </div>

        <div className="section-label">Preferences</div>
        <div className="me-group">
          <SwitchRow
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
                <circle cx="12" cy="12" r="2.8" />
              </svg>
            }
            title="Hide amounts"
            sub="Mask money on screen"
            on={hideMoney}
            onClick={toggleHideMoney}
          />
          <SwitchRow
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.2 2.2 6H4.3c.7-.8 2.2-2 2.2-6z" />
                <path d="M10 19a2.2 2.2 0 0 0 4 0" />
              </svg>
            }
            title="Overdue reminders"
            sub={
              remindersOn && notificationsSupported() && notificationPermission() === 'denied'
                ? 'Notifications blocked in browser'
                : 'Remind when opening the app'
            }
            on={remindersOn}
            onClick={toggleReminders}
          />
          <Row
            icon={
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7v10M9.5 9.2a2.5 2.5 0 0 1 4.6.3M14.5 14.8a2.5 2.5 0 0 1-4.6-.3" />
              </svg>
            }
            title="Currency"
            sub={`Shown as ${currency.symbol} across the app`}
            tail={<span className="me-row-val">{currency.code}</span>}
            onClick={() => setCurOpen((v) => !v)}
          />
          {curOpen &&
            CURRENCIES.map((c) => (
              <Row
                key={c.code}
                icon={<span className="me-cur-sym">{c.symbol}</span>}
                title={`${c.code} · ${c.label}`}
                tail={
                  c.code === currency.code ? (
                    <span className="me-cur-check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  ) : undefined
                }
                onClick={() => {
                  setCurrency(c.code)
                  setCurOpen(false)
                }}
              />
            ))}
        </div>

        {isSupabaseConfigured && (
          <>
            <div className="section-label">Cloud sync</div>
            <div className="me-group">
              <Row
                icon={
                  <svg viewBox="0 0 24 24">
                    <path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.6A3.5 3.5 0 0 1 18 18H7z" />
                    <path d="M12 21v-7M9 16l3-3 3 3" />
                  </svg>
                }
                title={sync.state === 'syncing' ? 'Syncing…' : 'Sync now'}
                sub={syncLabel}
                tail={Chevron}
                onClick={() => pushRemote()}
                disabled={sync.state === 'syncing'}
              />
            </div>
          </>
        )}

        <div className="section-label">Data</div>
        <div className="me-group">
          {storage && (
            <Row
              icon={
                <svg viewBox="0 0 24 24">
                  <ellipse cx="12" cy="6" rx="7" ry="3" />
                  <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
                </svg>
              }
              title="Storage"
              sub={
                storage.pct >= 80
                  ? 'Near limit — export a backup'
                  : `${fmtStorage(storage.usedMB)} of ${fmtStorage(storage.quotaMB)} used`
              }
              tail={
                storage.pct < 1 ? (
                  <span className="me-row-val">OK</span>
                ) : (
                  <span className={'me-row-val' + (storage.pct >= 80 ? ' warn' : '')}>{storage.pct.toFixed(0)}%</span>
                )
              }
            />
          )}
          <Row
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M12 3v11M8 10l4 4 4-4" />
                <path d="M5 20h14" />
              </svg>
            }
            title="Export backup (JSON)"
            sub="Save a snapshot to your device"
            tail={Chevron}
            onClick={doExport}
            disabled={exporting}
          />
          <Row
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M12 15V4M8 8l4-4 4 4" />
                <path d="M5 20h14" />
              </svg>
            }
            title="Import backup"
            sub="Restore or merge from a JSON file"
            tail={Chevron}
            onClick={() => fileRef.current?.click()}
          />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
        {msg && <p className="hint ok">{msg}</p>}

        {isSupabaseConfigured && (
          <div className="me-group me-group-foot">
            <Row
              icon={
                <svg viewBox="0 0 24 24">
                  <path d="M15 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" />
                  <path d="M18 15l3-3-3-3M21 12H9" />
                </svg>
              }
              title="Sign out"
              danger
              tail={Chevron}
              onClick={() => setAskSignOut(true)}
            />
          </div>
        )}

        {/* 极淡的版本/署名收尾行 */}
        <p className="me-version">v0.1 · Made for creators</p>
    </div>

    {askSignOut && (
      <ConfirmDialog
        title="Sign out?"
        message="Pending changes are pushed first. You'll need to sign in again to sync."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          setAskSignOut(false)
          void doSignOut()
        }}
        onCancel={() => setAskSignOut(false)}
      />
    )}
    </>
  )
}
