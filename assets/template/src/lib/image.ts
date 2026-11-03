/**
 * 把用户从相册选的头像图片压缩成体积可控的 base64 data URL。
 * 默认最长边 ≤ 512px、JPEG 质量 0.82——头像无需高清，控制 IndexedDB 占用。
 */
export function fileToAvatar(file: File, maxDim = 512, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img
        const scale = Math.min(1, maxDim / Math.max(w, h))
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        ctx.drawImage(img, 0, 0, cw, ch)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to read image'))
    }
    img.src = url
  })
}
