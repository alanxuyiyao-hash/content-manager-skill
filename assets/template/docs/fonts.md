# 字体与离线使用

界面继续使用原版 Clash Display（500/600/700）与 General Sans（400/500/600），布局、字号、颜色均保留。

默认 CSS 与关键字体预加载直接指向 Fontshare 官方 CDN。无需字体文件即可构建。首次显示字体需要网络；生产版 PWA 会缓存访问过的字体，未缓存或 CDN 不可达时使用原有系统字体兜底。开发服务器不提供完整的生产版离线行为。

Fontshare 将这两款字体标为 Closed Source。其 [ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl)（核对于 2026-11-03）允许使用与为自有应用自托管，但限制在仓库、模板等渠道重新分发字体文件。因此开源包不包含 WOFF2 二进制，MIT 也不覆盖字体。

需要完全本地字体时：

1. 从 [Clash Display](https://www.fontshare.com/fonts/clash-display) 和 [General Sans](https://www.fontshare.com/fonts/general-sans) 官方页面独立取得字体并阅读适用许可。
2. 解压后将两个字体目录放在同一父目录，运行：

   ```bash
   python3 scripts/use_local_fonts.py --from-dir /path/to/your-font-downloads
   npm run build
   ```

脚本识别官方文件名或原项目的标准文件名，复制六个静态 WOFF2 文件并切换 CSS/预加载地址，不改字形或字体元数据。文件保存在 `public/fonts/` 并已被 Git 忽略。PWA 构建会预缓存本地字体，Android 构建也会将其打包到自用应用。公开源码和 Skill 压缩包不附带这些文件。

切回默认 CDN 版本时，恢复 `src/styles.css` 和 `index.html` 到模板版本。不需要更换字体或重做设计。官方资源变化或字体版本变化可能影响细微渲染，复核时确认实际加载字体。
