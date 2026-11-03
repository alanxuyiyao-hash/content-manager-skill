# 模板边界与维护入口

原版是移动端优先的暖纸色界面：纸白背景、近黑文字、低饱和身份色、圆角面板、浮动底栏与快记按钮。标题和金额用 Clash Display，正文用 General Sans。保留内置标志、英文界面和响应式桌面显示。

| 页面 | 入口文件 | 功能 |
| --- | --- | --- |
| Home | `src/pages/Projects.tsx` | 内容项目、生产与回款状态、排序与排期 |
| Calendar | `src/pages/CalendarPage.tsx` | 发布与项目日程 |
| Stats | `src/pages/Monthly.tsx` | 收入、成本、净额、待回款、固定开销 |
| Insights | `src/pages/Insights.tsx` | 播放、点赞、收藏、涨粉、投放表现 |
| Me | `src/components/Settings.tsx` | 个人资料、隐私、币种、提醒、备份、同步状态 |

`ProjectDetail.tsx` 编辑项目与商单，`QuickCapture.tsx` 提供快捷录入。示例为虚构内容。项目不含社交平台自动抓取、AI 写作或自动发布能力。

## 定制入口

- 展示名称：`index.html`、`vite.config.ts` manifest、`capacitor.config.ts`、Android `res/values/strings.xml`，以及 `AuthGate.tsx` 登录标题。
- 标志：`public/favicon.svg`、`assets/logo.svg`、`scripts/icon-master.svg` 和平台生成图标。用户要求时才替换。
- 币种与个人资料优先用 Settings，不改统计代码。
- 云端：`supabase/migrations/202611030001_app_state.sql` 和 `docs/cloud-sync.md`。
- Android ID 需同步修改 Capacitor 配置、Gradle namespace/applicationId、Java 包名/目录、测试包名和 Android strings。

## 包装与原项目的差异

业务数据与计算逻辑保持原样。`SwipeRow.tsx` 将鼠标捕获推迟到横向拖动判定后，修复普通点击无法打开卡片的问题；新增项目编辑、持久化和备份往返浏览器回归测试。更新构建/测试与 Android 依赖以修复已知高危问题，补齐 Node 类型声明，浏览器测试使用独立服务器以避免误连其他应用。CSS 仅更改六个字体来源与对应说明，全部布局规则保留。新增字体运行时缓存与本地字体导入脚本，移除 preview 的任意主机放行配置。Android 包名改为公共示例标识。增加开源许可、文档、云端迁移与隔离验证 SQL；排除原 Git 历史、字体二进制、构建缓存、个人路径、环境配置、签名文件与历史开发笔记。

模板不含现有用户的浏览器数据库或云端数据。不要补入真实备份、账号或 `.env.local`。
