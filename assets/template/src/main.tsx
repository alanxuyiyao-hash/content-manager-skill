import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { toast } from './components/Toast'
import './styles.css'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import { startAppUpdates } from './lib/appUpdates'

document.documentElement.dataset.capacitorPlatform = Capacitor.getPlatform()

// 全局错误兜底：React 边界抓不到的事件回调 / Promise rejection（如 IndexedDB 写失败），
// 至少给个提示并打日志，不再静默
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
  toast('Something failed — storage may be full')
})
window.addEventListener('error', (e) => {
  console.error('[window error]', e.error ?? e.message)
})

// 申请持久化存储，降低 Safari 在存储紧张时清掉本地数据的概率
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((already) => {
    if (!already) navigator.storage.persist().catch(() => {})
  })
}

// 有新版本时提示刷新（registerType: 'prompt'）：避免主屏 App 一直跑旧代码。
// 用带 action 的 App 内 toast 替换系统 confirm() 灰框：非阻塞、可稍后再点、贴合暖色风格。
startAppUpdates({
  isNative: Capacitor.isNativePlatform(),
  register: registerSW,
  notify: toast,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
