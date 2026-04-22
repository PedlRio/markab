const MAX_DIMENSION = 1200
const QUALITY = 0.85

export async function compressImageFile(file: File): Promise<string> {
  const originalDataUrl = await readAsDataURL(file)
  const img = await loadImage(originalDataUrl)

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
  if (scale === 1 && file.size < 200_000) return originalDataUrl

  const targetW = Math.round(img.width * scale)
  const targetH = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return originalDataUrl

  ctx.drawImage(img, 0, 0, targetW, targetH)

  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const compressed = canvas.toDataURL(mime, QUALITY)

  return compressed.length < originalDataUrl.length ? compressed : originalDataUrl
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
