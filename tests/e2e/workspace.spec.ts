import type { Page } from '@playwright/test'
import type { WxtBrowser } from 'wxt/browser'
import { cm, expect, openNewTab, reveal, test } from './fixtures'

declare const chrome: WxtBrowser

test.use({ engine: 'livePreview' })

const seed = async (page: Page, content: string) => {
  await page.evaluate(
    (c) =>
      chrome.storage.local.set({
        'note:n1': { id: 'n1', title: 'Doc', content: c, createdAt: 2, updatedAt: 2, tags: [], folderId: null },
        'note:n2': { id: 'n2', title: 'Other', content: 'other body', createdAt: 1, updatedAt: 1, tags: [], folderId: null },
      }),
    content,
  )
  await page.evaluate(() => localStorage.setItem('markab:lastNote', 'n1'))
  await page.reload()
  await reveal(page)
}

const DOC = ['# Top', 'intro', '## Section A', 'alpha line', '### Sub', 'sub line', '## Section B', 'beta line'].join('\n')

test('heading chevron folds its whole section, and the fold survives a reload', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, DOC)
  await expect(cm(page)).toContainText('alpha line')

  const sectionA = cm(page).locator('.cm-line', { hasText: /^Section A/ })
  await sectionA.hover()
  await sectionA.locator('.mk-fold-indicator').click()

  // Section A (including its ### Sub) is hidden; the next ## stays visible.
  await expect(cm(page)).not.toContainText('alpha line')
  await expect(cm(page)).not.toContainText('sub line')
  await expect(cm(page)).toContainText('Section B')
  await expect(cm(page)).toContainText('beta line')
  await expect(sectionA.locator('.mk-fold-indicator')).toHaveClass(/is-collapsed/)

  await page.reload()
  await reveal(page)
  await expect(cm(page)).toContainText('Section B')
  await expect(cm(page)).not.toContainText('alpha line')

  // Folding never touches the Markdown itself.
  const stored = await page.evaluate(() => chrome.storage.local.get('note:n1'))
  expect((stored['note:n1'] as { content: string }).content).toBe(DOC)

  await cm(page).locator('.cm-line', { hasText: /^Section A/ }).locator('.mk-fold-indicator').click()
  await expect(cm(page)).toContainText('alpha line')
})

test('top-level heading folds everything below it', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, DOC)
  const top = cm(page).locator('.cm-line', { hasText: /^Top$/ })
  await top.hover()
  await top.locator('.mk-fold-indicator').click()
  await expect(cm(page)).toHaveText(/^Top…?$/)
})

test('list items with children fold', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, '- parent\n  - child one\n  - child two\n- sibling')
  const parent = cm(page).locator('.cm-line', { hasText: /^\s*parent/ })
  await parent.hover()
  await parent.locator('.mk-fold-indicator').click()
  await expect(cm(page)).not.toContainText('child one')
  await expect(cm(page)).toContainText('sibling')
  // Leaf items get no chevron.
  await expect(cm(page).locator('.cm-line', { hasText: /^\s*sibling/ }).locator('.mk-fold-indicator')).toHaveCount(0)
})

test('file explorer: new folder renames inline, context menu renames notes', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, 'body')
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Rename').fill('Projects')
  await page.getByLabel('Rename').press('Enter')
  await expect(page.getByTestId('folder-name')).toHaveText('Projects')

  await page.getByTestId('note-row').filter({ hasText: 'Other' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByLabel('Rename').fill('Renamed')
  await page.getByLabel('Rename').press('Enter')
  await expect(page.getByTestId('note-row')).toHaveText(['Doc', 'Renamed'])
})

test('back and forward move between visited notes', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, 'body')
  await page.getByTestId('note-row').filter({ hasText: 'Other' }).click()
  await expect(page.getByLabel('Note title')).toHaveValue('Other')
  await page.getByRole('button', { name: 'Navigate back' }).click()
  await expect(page.getByLabel('Note title')).toHaveValue('Doc')
  await page.getByRole('button', { name: 'Navigate forward' }).click()
  await expect(page.getByLabel('Note title')).toHaveValue('Other')
})

test('sidebar toggles and search finds notes by content', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await seed(page, 'body')
  await page.getByRole('button', { name: 'Search' }).first().click()
  await page.getByLabel('Search notes').fill('other bo')
  await expect(page.getByTestId('note-row')).toHaveText(['Other'])
  await page.getByTestId('note-row').click()
  await expect(page.getByLabel('Note title')).toHaveValue('Other')

  await page.getByRole('button', { name: 'Toggle left sidebar' }).click()
  await expect(page.getByRole('complementary', { name: 'Left sidebar' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle left sidebar' }).click()
  await expect(page.getByRole('complementary', { name: 'Left sidebar' })).toBeVisible()
})
