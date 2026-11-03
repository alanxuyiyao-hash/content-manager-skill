import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 图标母版：内嵌高清位图的 SVG，只作构建期源。放在 scripts/ 而非 public/，
// 否则会被 VitePWA/workbox 一并预缓存（~490KB），白占离线包体积。
const svg = readFileSync(join(root, 'scripts', 'icon-master.svg'))
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

// 母版画面（墨线主体）实测边界：x 9.4%~91.0%、y 9.4%~81.3%（256px 渲染、与背景色差阈值 150 扫描）。
// 即画面只占 82%×72% 且重心偏上——直接整版输出会显得"眼镜太小"（真机主屏反馈）。
// 下面所有输出先把画面重心平移到画布中心，再围绕中心缩放到目标占比。
const ART = { cx: 0.502, cy: 0.4535, w: 0.816 } // 画面中心 / 宽占比（相对母版）
// 目标占比：普通图标（iOS 主屏/PWA manifest，整版可见）画面占宽 ~91%；
// maskable（安卓自适应，会被圆/圆角罩裁切）画面占宽 ~77%——
// 逐像素实测（墨线阈值 180，最远点=眼镜右下角）：纯圆裁切上限 87%、
// 22.5% 圆角方上限 99%，77% 对两者都留足余量（真机反馈二轮：68% 仍偏小）。
const REG_SCALE = 0.91 / ART.w   // ≈1.12：普通图标的母版内容缩放
const MASK_SCALE = 0.77 / ART.w  // ≈0.94：maskable 的母版内容缩放
// 光学居中：画面头轻脚重（上半是细水滴/弧线、下半是粗镜框），几何居中时墨量质心
// 落在 56%（真机反馈"感觉偏下"）。整体上提 3%（质心偏移的一半）——下留白略大于上，
// 视觉才是正的。上提同时给圆形裁切的底部约束(眼镜右下角)让出更多余量，maskable 更安全。
const LIFT = 0.03 // 画布高度占比

// 采样母版左上角像素作背景色；若该角透明则回退暖白底 token（#EFEDE6）
const probe = new Resvg(svg, { fitTo: { mode: 'width', value: 8 } }).render().pixels
const bg = probe[3] < 128 ? '#EFEDE6' : `rgb(${probe[0]}, ${probe[1]}, ${probe[2]})`

// 把母版内容按 contentScale 输出：先平移使画面重心居中，再围绕画布中心缩放，
// 四周用背景色补满（与母版底色无缝，不出现裸边）。
function wrapArt(contentScale) {
  const inner = svg.toString().replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const dx = (0.5 - ART.cx) * 512
  const dy = (0.5 - ART.cy) * 512
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${bg}"/>` +
    // 母版位图四角有边缘瑕疵（左下/右下各一撮淡灰像素，位于最外 2% 边缘带；画面主体最远只到 91%），
    // 裁掉最外 2.5% 再参与变换，避免上提/缩放后瑕疵进入画布
    `<clipPath id="trim"><rect x="12.8" y="12.8" width="486.4" height="486.4"/></clipPath>` +
    // 变换从右往左生效：先平移使画面重心居中 → 围绕画布中心缩放 → 最后整体光学上提（画布坐标，与缩放无关）
    `<g transform="translate(0,${(-LIFT * 512).toFixed(1)}) translate(256,256) scale(${contentScale}) translate(-256,-256) translate(${dx},${dy})">` +
    `<g clip-path="url(#trim)">${inner}</g>` +
    `</g>` +
    `</svg>`
  )
}

function render(size, name, contentScale, note) {
  const r = new Resvg(wrapArt(contentScale), { fitTo: { mode: 'width', value: size } })
  writeFileSync(join(outDir, name), r.render().asPng())
  console.log('  ✓', name, `${size}px (${note}, 内容×${contentScale.toFixed(2)})`)
}

render(192, 'icon-192.png', REG_SCALE, 'regular')
render(512, 'icon-512.png', REG_SCALE, 'regular')
render(512, 'maskable-512.png', MASK_SCALE, 'maskable')
render(180, 'apple-touch-icon.png', REG_SCALE, 'apple-touch')
console.log('图标生成完成')
