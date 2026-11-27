import type { Page } from '@playwright/test'
import { cm, expect, openNewTab, reveal, test } from './fixtures'

/**
 * Real vault sync in Chromium. The vault is a folder in the browser's Origin Private File
 * System: a genuine FileSystemDirectoryHandle with write access, stored exactly where
 * "Connect vault" stores the picked folder. Only the folder picker itself is skipped.
 */
test.use({ engine: 'livePreview' })

type Files = Record<string, string>

const setupVault = (page: Page, files: Files) =>
  page.evaluate(async (files) => {
    const opfs = await navigator.storage.getDirectory()
    await opfs.removeEntry('vault', { recursive: true }).catch(() => {})
    const root = await opfs.getDirectoryHandle('vault', { create: true })
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/')
      let dir = root
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
      const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
      await w.write(
        text.startsWith('base64:') ? Uint8Array.from(atob(text.slice(7)), (c) => c.charCodeAt(0)) : text,
      )
      await w.close()
    }
    // Store the handle where the app keeps the connected vault (IndexedDB "ntm" / "kv").
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('ntm', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(root, 'vaultHandle')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, files)

/** What Obsidian would see on disk (hidden folders included, to prove they're untouched). */
const readVault = (page: Page) =>
  page.evaluate(async () => {
    const out: Record<string, string> = {}
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, path)
        else {
          const file = await (entry as FileSystemFileHandle).getFile()
          out[path] = /\.(png|jpe?g|gif|webp)$/i.test(entry.name) ? `<${file.size} bytes>` : await file.text()
        }
      }
    }
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('vault'), '')
    return out
  })

/** Simulate editing a file in Obsidian. */
const obsidianWrite = (page: Page, path: string, text: string) =>
  page.evaluate(
    async ({ path, text }) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('vault')
      const parts = path.split('/')
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
      const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
      await w.write(text)
      await w.close()
    },
    { path, text },
  )

/** Coming back to the tab triggers a vault scan (throttled to one per 1.5 s). */
const returnToTab = async (page: Page) => {
  await page.waitForTimeout(1600)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

const VAULT: Files = {
  'Welcome.md': '---\ntags: [start]\n---\n# Hello from Obsidian\n\n- [ ] try Markab',
  'Projects/Markab/Roadmap.md': '## Next\n\nvault sync',
  '.obsidian/app.json': '{}',
  '.trash/Old.md': 'should be ignored',
}

test('opening Markab with a vault imports its notes and folders', async ({ context, extensionId, errors }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, VAULT)
  await page.reload()
  await reveal(page)

  // The explorer opens the active note's folders, as Obsidian does, so both notes show.
  await expect(page.getByTestId('folder-name')).toHaveText(['Projects', 'Markab'])
  await expect(page.getByTestId('note-row')).toHaveText(['Roadmap', 'Welcome'])
  await page.getByTestId('note-row').filter({ hasText: 'Roadmap' }).click()
  await expect(cm(page)).toContainText('vault sync')
  await page.getByTestId('note-row').filter({ hasText: 'Welcome' }).click()
  await expect(cm(page)).toContainText('Hello from Obsidian')

  // Nothing was rewritten, and hidden folders were left alone.
  expect(await readVault(page)).toEqual(VAULT)
  expect(errors).toEqual([])
})

test('edits in Markab are saved as Obsidian files, keeping frontmatter', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, VAULT)
  await page.reload()
  await reveal(page)
  await page.getByTestId('note-row').filter({ hasText: 'Welcome' }).click()

  await cm(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nadded in Markab')
  await expect.poll(async () => (await readVault(page))['Welcome.md']).toContain('added in Markab')
  expect((await readVault(page))['Welcome.md']).toMatch(/^---\ntags: \[start\]\n---\n# Hello from Obsidian/)

  // Renaming the note renames the file.
  await page.getByLabel('Note title').fill('Start here')
  await expect.poll(async () => Object.keys(await readVault(page)).filter((p) => !p.startsWith('.'))).toEqual(
    expect.arrayContaining(['Start here.md', 'Projects/Markab/Roadmap.md']),
  )
  expect((await readVault(page))['Welcome.md']).toBeUndefined()

  // A brand-new note becomes "Title.md".
  await page.getByRole('button', { name: 'New note' }).first().click()
  await page.getByLabel('Note title').fill('Shopping')
  await page.getByLabel('Note title').press('Enter')
  await page.keyboard.type('milk')
  await expect.poll(async () => (await readVault(page))['Shopping.md']).toBe('milk')
})

test('changes made in Obsidian show up when you come back to the tab', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, VAULT)
  await page.reload()
  await reveal(page)
  await page.getByTestId('note-row').filter({ hasText: 'Welcome' }).click()
  await expect(cm(page)).toContainText('Hello from Obsidian')

  await obsidianWrite(page, 'Welcome.md', '---\ntags: [start]\n---\n# Edited in Obsidian')
  await obsidianWrite(page, 'Inbox/New idea.md', 'fresh from Obsidian')
  await returnToTab(page)

  await expect(cm(page)).toContainText('Edited in Obsidian')
  await expect(page.getByTestId('folder-name')).toContainText(['Inbox'])
})

test('two open tabs never import the same file twice', async ({ context, extensionId }) => {
  const first = await openNewTab(context, extensionId)
  await setupVault(first, VAULT)
  const pages = await Promise.all([openNewTab(context, extensionId), openNewTab(context, extensionId)])
  for (const p of pages) await reveal(p)
  await first.reload()
  await reveal(first)
  await first.waitForTimeout(1000)
  const notes = await first.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = await (globalThis as any).chrome.storage.local.get(null)
    return Object.keys(all).filter((k) => k.startsWith('note:')).length
  })
  expect(notes).toBe(2)
})

/** A real 1×1 PNG. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const pasteImage = (page: Page) =>
  page.locator('.cm-content').evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, PNG_B64)

test('![[image]] embeds from the vault are displayed', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, {
    'Media/cat.png': `base64:${PNG_B64}`,
    'Pets.md': 'My cat:\n\n![[cat.png|120]]\n\nand a missing one ![[nope.png]]',
  })
  await page.reload()
  await reveal(page)
  const img = cm(page).locator('.image-embed img')
  await expect(img).toHaveAttribute('src', /^blob:/)
  await expect(img).toHaveAttribute('width', '120')
  await expect(img).toHaveJSProperty('naturalWidth', 1) // the real file was decoded
  await expect(cm(page).locator('.image-embed.is-unresolved')).toContainText('nope.png')
})

test('pasting an image saves it in the vault and embeds it, like Obsidian', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, { 'Doc.md': 'before' })
  await page.reload()
  await reveal(page)
  await cm(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' ')
  await pasteImage(page)

  await expect
    .poll(async () => Object.keys(await readVault(page)).find((p) => /^Pasted image \d{14}\.png$/.test(p)))
    .toBeTruthy()
  await expect.poll(async () => (await readVault(page))['Doc.md']).toMatch(/^before !\[\[Pasted image \d{14}\.png\]\]$/)
  await page.getByLabel('Note title').click() // move the cursor away → rendered
  await expect(cm(page).locator('.image-embed img')).toHaveAttribute('src', /^blob:/)
})

test("pasted images go where Obsidian's attachment setting says", async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await setupVault(page, {
    'Notes/Doc.md': 'x',
    '.obsidian/app.json': JSON.stringify({ attachmentFolderPath: './assets' }),
  })
  await page.reload()
  await reveal(page)
  await page.getByTestId('note-row').filter({ hasText: 'Doc' }).click()
  await cm(page).click()
  await pasteImage(page)
  await expect
    .poll(async () => Object.keys(await readVault(page)).some((p) => /^Notes\/assets\/Pasted image \d{14}\.png$/.test(p)))
    .toBe(true)
})

test('without a vault, a pasted image is kept inside the note', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await reveal(page)
  await page.getByRole('button', { name: 'Create your first note' }).click()
  await page.getByLabel('Note title').press('Enter')
  await pasteImage(page)
  await page.getByLabel('Note title').click()
  await expect(cm(page).locator('img.mk-image')).toHaveAttribute('src', /^data:image\/png/)
})
