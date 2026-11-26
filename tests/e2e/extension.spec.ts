import type { WxtBrowser } from 'wxt/browser'
import { body, expect, openNewTab, reveal, test } from './fixtures'

declare const chrome: WxtBrowser

// These scenarios exercise the classic (Tiptap) editor; live-preview.spec.ts covers CodeMirror.
test.use({ engine: 'classic' })

test('replaces the new tab page', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto('chrome://newtab')
  await expect(page).toHaveURL(new RegExp(`chrome-extension://${extensionId}/newtab.html`))
  await expect(page.getByRole('button', { name: 'Reveal notes' })).toBeVisible()
})

test('creates, edits and persists a note', async ({ context, extensionId, errors }) => {
  const page = await openNewTab(context, extensionId)
  await reveal(page)
  await page.getByRole('button', { name: 'Create your first note' }).click()

  await page.getByLabel('Note title').fill('Shopping')
  await body(page).click()
  await page.keyboard.type('# Groceries')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[ ] milk')
  await page.keyboard.press('Enter')
  await page.keyboard.type('eggs ==fresh== ')

  await expect(body(page).locator('h1')).toHaveText('Groceries')
  await expect(body(page).locator('ul[data-type="taskList"] li')).toHaveCount(2)

  // Close the tab right away: pending edits must be flushed, not lost.
  await page.close()

  const again = await openNewTab(context, extensionId)
  await reveal(again)
  await expect(again.getByTestId('note-row')).toHaveText('Shopping')
  await expect(body(again).locator('h1')).toHaveText('Groceries')
  await expect(body(again).locator('mark')).toHaveText('fresh')

  const stored = await again.evaluate(() => chrome.storage.local.get(null))
  const note = Object.entries(stored).find(([k]) => k.startsWith('note:'))?.[1] as { content: string }
  expect(note.content).toContain('# Groceries')
  expect(note.content).toContain('- [ ] milk')
  expect(note.content).toContain('==fresh==')
  expect(errors).toEqual([])
})

test('slash command palette inserts blocks', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await reveal(page)
  await page.getByRole('button', { name: 'New note' }).first().click()
  await body(page).click()
  await page.keyboard.type('/')
  await page.getByPlaceholder('Filter commands…').fill('quote')
  await page.keyboard.press('Enter')
  await page.keyboard.type('wise words')
  await expect(body(page).locator('blockquote')).toHaveText('wise words')
  await expect(body(page)).not.toContainText('/')
})

test('two open tabs never overwrite each other', async ({ context, extensionId }) => {
  const a = await openNewTab(context, extensionId)
  await reveal(a)
  await a.getByRole('button', { name: 'New note' }).first().click()
  await a.getByLabel('Note title').fill('From A')

  // Tab B was opened before A's note existed in its memory... and still sees it live.
  const b = await openNewTab(context, extensionId)
  await reveal(b)
  await expect(b.getByTestId('note-row')).toHaveText(['From A'])
  await b.getByRole('button', { name: 'New note' }).first().click()
  await b.getByLabel('Note title').fill('From B')

  await expect(a.getByTestId('note-row')).toHaveText(['From A', 'From B'])

  // Edit A's note in A after B wrote: both must survive.
  await a.getByTestId('note-row').filter({ hasText: 'From A' }).click()
  await body(a).click()
  await a.keyboard.type('still here')
  await a.waitForTimeout(600)

  const c = await openNewTab(context, extensionId)
  await reveal(c)
  await expect(c.getByTestId('note-row')).toHaveText(['From A', 'From B'])
  await c.getByTestId('note-row').filter({ hasText: 'From A' }).click()
  await expect(body(c)).toHaveText('still here')
})

test('migrates notes saved by the old new-tab-mark build', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await page.evaluate(() =>
    chrome.storage.local.clear().then(() =>
      chrome.storage.local.set({
        notes: [
          {
            id: 'legacy-1',
            title: 'Old note',
            filename: 'note-legacy-1.md',
            content: '## Kept\n\n- [x] migrated',
            createdAt: 1,
            updatedAt: 1,
            tags: [],
            folderId: null,
          },
        ],
        editorPrefs: { fontSize: 18, widthId: 'wide' },
        prefs: { editor: 'classic' },
      }),
    ),
  )
  await page.reload()
  await reveal(page)
  await expect(page.getByTestId('note-row')).toHaveText('Old note')
  await expect(body(page).locator('h2')).toHaveText('Kept')
  await expect(body(page).locator('li[data-checked="true"]')).toHaveCount(1)
})

test('display setting can skip the privacy overlay', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await reveal(page)
  await page.getByRole('button', { name: 'Create your first note' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Hide notes when a new tab opens' }).click()

  const next = await openNewTab(context, extensionId)
  await expect(next.getByLabel('Note title')).toBeVisible()
  await expect(next.getByRole('button', { name: 'Reveal notes' })).toHaveCount(0)
})
