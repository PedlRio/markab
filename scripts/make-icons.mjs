// Renders scripts/icon.svg into the PNG sizes Chrome wants (public/icon/*.png).
// Run after editing the SVG: `node scripts/make-icons.mjs`
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('./icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  )
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true })
}
await browser.close()
console.log('icons written to public/icon/')
