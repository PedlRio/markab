import path from 'node:path'
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test'
import type { WxtBrowser } from 'wxt/browser'

// Code passed to page.evaluate runs inside the extension page, where `chrome` exists.
declare const chrome: WxtBrowser

/**
 * Loads the production build (.output/chrome-mv3) as an unpacked extension in a real
 * Chromium — the same thing "Load unpacked" does — and drives the new tab page.
 * Run with `npm run test:e2e` (it builds first).
 */
const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../.output/chrome-mv3')

export const test = base.extend<{
  engine: 'classic' | 'livePreview'
  context: BrowserContext
  extensionId: string
  errors: string[]
}>({
  engine: ['livePreview', { option: true }],
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context, engine }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await worker.evaluate(
      (editor) => chrome.storage.local.set({ prefs: { fontSize: 16, widthId: 'medium', hideOnOpen: true, editor } }),
      engine,
    )
    await use(new URL(worker.url()).host)
  },
  errors: async ({ context }, use) => {
    const errors: string[] = []
    context.on('page', (page) => {
      page.on('pageerror', (err) => errors.push(err.message))
      page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
    })
    await use(errors)
  },
})

export { expect } from '@playwright/test'

export const openNewTab = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  return page
}

export const reveal = async (page: Page) => {
  await page.getByRole('button', { name: 'Reveal notes' }).click()
}

/** The classic (Tiptap) editor surface. */
export const body = (page: Page) => page.locator('.mk-editor .ProseMirror')

/** The live preview (CodeMirror) editor surface. */
export const cm = (page: Page) => page.locator('.cm-content')

export const storedNotes = (page: Page) =>
  page.evaluate(async () => {
    const all = await chrome.storage.local.get(null)
    return Object.entries(all)
      .filter(([k]) => k.startsWith('note:'))
      .map(([, v]) => v as { id: string; title: string; content: string })
  })
