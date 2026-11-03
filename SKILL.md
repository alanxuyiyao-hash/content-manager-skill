---
name: content-manager
description: 基于内置 Content Manager 源码生成或定制自媒体管理应用，保留暖纸色界面、内容排期、商单收支、内容表现分析、本地备份及可选云同步。用于“生成同款内容管家”“搭建自媒体管理工具”；不用于直接操作现有账号数据或自动发布内容。
---

# Content Manager 内容管家

使用 `assets/template/` 的完整 React + TypeScript + Vite 源码作为基底。模板自包含，不依赖作者电脑路径、账号或原仓库。默认生成当前版本的界面与功能，不重新设计。

## 生成与启动

1. 运行生成器，输出必须是不存在的新目录：

   ```bash
   python3 <skill目录>/scripts/create_app.py --output <新应用目录>
   cd <新应用目录>
   npm ci
   npm run dev -- --host 127.0.0.1
   ```

   需要 Python 3.9+ 和 Node.js 22.12+。生成器只复制文件，不联网、不安装依赖、不部署。
2. 默认不创建 `.env.local`，直接以本地模式使用。`/?demo` 展示虚构示例，正式录入使用 `/`。示例时间固定在 2026 年 3–7 月；当月为空时切换月份，不要自动写入真实数据库。
3. 阅读 [references/template.md](references/template.md) 确认功能与定制边界。没有明确的定制要求时，保留原版英文 UI、Ledger 名称、字体、配色、布局、交互和计算逻辑。
4. 默认使用 Fontshare 官方 CDN 上的原字体。网络不可用时系统字体会代替，不能称其为原样式验证通过。完整离线字体按应用的 `docs/fonts.md` 处理，由用户独立获取字体后运行 `scripts/use_local_fonts.py`；不要将字体二进制放入开源包。

## 保留行为

- 保留 Home、Calendar、Stats、Insights、Me 五页，以及项目编辑、快记、排期、回款状态、投放记录、固定开销、复盘、个人资料、隐私展示和 JSON 导入导出。
- 生产阶段与收款状态分开；项目收支按权威发布日期归月，固定开销按自身日期归月。保留 `money.ts`、`date.ts`、`projectSchedule.ts` 的既有口径。
- 保留 IndexedDB 版本链、备份版本、同步冲突合并与删除墓碑。云端协议是 `app_state` 中每个用户一条 JSON 快照，不能直接改成互不兼容的逐项目表。
- 保留 PWA 更新提示、离线资源缓存、Android 返回键、安全区和原生分享备份。模板使用示例包名 `com.example.contentmanager`；正式分发前换成用户自有唯一标识。
- 只改用户要求的内容。布局复用 `src/styles.css` token，不用另一套组件库重写。旧 Inbox、Spark、独立个人事件已经退役，不按旧文档重新添加。

## 云同步与部署

用户需要时阅读应用的 `docs/cloud-sync.md`，在用户选定的新 Supabase 项目执行迁移、创建邮箱密码用户，再填 `.env.local`。客户端仅用 URL 与公开 anon/publishable key，不放管理密钥。不覆盖现有数据库。

保留静态部署配置，按用户当前指令处理发布。首次启用云同步前先备份：本地尚未上传的记录可能会合并到登录账号；同一浏览器本地库不按账号隔离，多人使用应分浏览器配置文件或设备。

## 验证与交付

- 在生成目录运行 `npm run typecheck`、`npm test`、`npm run build`。
- 有浏览器环境时运行 `npx playwright install chromium` 和 `npx playwright test`，检查 390px 与桌面宽度下五个标签页、项目创建/编辑、刷新持久化、JSON 导出导入。
- 视觉改动后展示真实截图；原版样式验证需确认 Clash Display / General Sans 实际加载。
- Android 需要 JDK 21 和 Android SDK，见 `docs/android.md`。浏览器桥接模拟测试不能证明真机 APK 行为。
- 交付应用目录、启动命令与实际验证结果。云端登录、跨设备同步或真机安装未执行时明确说明。
