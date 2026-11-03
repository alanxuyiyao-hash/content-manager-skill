# Content Manager / 内容管家

个人自媒体管理 PWA，保留 Ledger 暖纸色界面与原有交互。React 18、TypeScript、Vite、Dexie / IndexedDB、可选 Supabase 云同步，以及 Capacitor Android。

## 启动

需要 Node.js 22.12+，无需配置后端即可本地使用：

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

终端显示本地地址。`/` 使用自己的本地数据；`/?demo` 浏览虚构示例，示例集中在 2026 年 3–7 月，可在日历/统计中切换到相应月份。Demo 用于预览，不是隔离沙箱；导入/导出仍可能操作本地数据库，测试请用独立浏览器配置文件。

## 保留的功能

- **Home**：内容项目、商单、生产与回款状态、排期、快捷新增与编辑。
- **Calendar**：发布日与项目日程。
- **Stats**：收入、投放、返点、成本、固定开销、净额与待回款。
- **Insights**：播放、点赞、收藏、涨粉与投放表现。
- **Me**：个人资料、币种、隐私展示、提醒、JSON 备份与可选云同步。

生产阶段与收款状态分开；项目收支按权威发布日期归月，固定开销按自身日期归月。保留原有数据迁移、备份版本、同步冲突合并与删除墓碑。旧 Inbox、Spark 和独立个人事件已退役，不是当前版本功能。

## 验证

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npx playwright test
```

浏览器测试中的 Android 桥接是模拟环境，不能替代真机安装。`npm run preview -- --host 127.0.0.1` 可检查生产版 PWA。iPhone 使用 Safari 添加到主屏幕。

## 可选配置

- [字体与完整离线字体](docs/fonts.md)：保留同款字体；默认从 Fontshare 官方 CDN 加载。字体文件不随开源源码分发。
- [云同步与部署](docs/cloud-sync.md)：使用自己的 Supabase 项目，包含初始化 SQL 与 RLS 验证事务。
- [Android 构建](docs/android.md)：需要 JDK 21 与 Android SDK。

本地数据存于当前浏览器，清理站点数据可能导致丢失，请定期导出 JSON。云同步按个人工具设计，同一浏览器本地库不隔离不同账号。

应用与模板代码采用 MIT；第三方依赖及字体有各自的许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
