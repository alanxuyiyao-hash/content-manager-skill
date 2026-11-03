import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 测试用独立配置：不加载 vite-plugin-pwa（测试无需 SW/manifest），
// 仅带 react 插件以支持 .tsx 里的 JSX 转换。纯逻辑测试跑 node 环境。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
