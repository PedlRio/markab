import type { Page } from '@playwright/test'
import { cm, expect, openNewTab, reveal, storedNotes, test } from './fixtures'

test.use({ engine: 'livePreview' })

const newNote = async (page: Page) => {
  await reveal(page)
  await page.getByRole('button', { name: 'Create your first note' }).click()
  await page.getByLabel('Note title').fill('Live')
  await page.getByLabel('Note title').press('Enter') // jumps into the body
}

/** Wait for the debounced save, then read the note's Markdown from storage. */
const savedContent = async (page: Page) => {
  await page.waitForTimeout(600)
  return (await storedNotes(page)).find((n) => n.title === 'Live')!.content
}

test('saves exactly the Markdown that was typed', async ({ context, extensionId, errors }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  const typed = '# Head\nSome **bold**, *it*, ==mark== and `code`.\n- [ ] task\n> [!note] Hi\n> there'
  // Type line by line: Enter would otherwise auto-continue lists and quotes.
  for (const [i, line] of typed.split('\n').entries()) {
    if (i) await page.keyboard.press('Shift+Enter')
    await page.keyboard.type(line)
  }
  // Shift+Enter is a plain newline in CodeMirror's default keymap.
  expect(await savedContent(page)).toBe(typed)
  expect(errors).toEqual([])
})

test('hides syntax away from the cursor and reveals it under the cursor', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('plain **bold**')
  await expect(cm(page).locator('.cm-strong')).toHaveText('**bold**') // cursor touches it → revealed
  await page.keyboard.type(' end')

  await page.keyboard.press('Home') // cursor leaves the bold span
  await expect(cm(page).locator('.cm-strong')).toHaveText('bold')
  await expect(cm(page)).toHaveText('plain bold end')

  await page.getByLabel('Note title').click() // editor blurred → fully rendered
  await expect(cm(page)).toHaveText('plain bold end')
})

test('checkbox toggles the task in the Markdown', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('- [ ] water plants')
  await page.getByLabel('Note title').click()
  await cm(page).locator('.task-list-item-checkbox').click()
  await expect(cm(page).locator('.task-list-item-checkbox')).toBeChecked()
  expect(await savedContent(page)).toBe('- [x] water plants')
})

test('Enter continues lists like Obsidian', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('- one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  expect(await savedContent(page)).toBe('- one\n- two')
})

test('clicking a [[wikilink]] opens (or creates) that note', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('see [[Ideas]] later')
  await page.getByLabel('Note title').click()
  await cm(page).locator('.internal-link').click()
  await expect(page.getByLabel('Note title')).toHaveValue('Ideas')
  await expect(page.getByTestId('note-row')).toHaveText(['Ideas', 'Live'])
})

test('source mode shows the raw Markdown', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('## Title with *style*')
  await page.getByLabel('Note title').click()
  await expect(cm(page)).toHaveText('Title with style')
  await page.getByRole('button', { name: 'click for Source mode' }).click()
  await expect(cm(page)).toHaveText('## Title with *style*')
})

test('switching editors keeps the note intact', async ({ context, extensionId }) => {
  const page = await openNewTab(context, extensionId)
  await newNote(page)
  await page.keyboard.type('Keep **this** ==safe==')
  await savedContent(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Classic' }).click()
  await expect(page.locator('.mk-editor .ProseMirror strong')).toHaveText('this')
  await expect(page.locator('.mk-editor .ProseMirror mark')).toHaveText('safe')
})

for (const engine of ['livePreview', 'classic'] as const) {
  test.describe(`${engine} editor`, () => {
    test.use({ engine })

    test('font size and readable line length settings apply to the text', async ({ context, extensionId }) => {
      const page = await openNewTab(context, extensionId)
      await newNote(page)
      await page.keyboard.type('Some text to measure')
      const text = engine === 'livePreview' ? cm(page) : page.locator('.mk-editor .ProseMirror')
      const measure = () =>
        text.evaluate((el) => ({ font: getComputedStyle(el).fontSize, width: el.getBoundingClientRect().width }))

      // The classic editor animates size changes, so poll until values settle.
      await expect.poll(async () => (await measure()).font).toBe('16px')

      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByLabel('Font size').fill('22')
      await page.getByRole('radio', { name: 'Narrow' }).click()
      await expect.poll(async () => (await measure()).font).toBe('22px')
      await expect.poll(async () => (await measure()).width).toBeLessThanOrEqual(640)
      const narrow = (await measure()).width

      await page.getByRole('radio', { name: 'Full' }).click()
      await expect.poll(async () => (await measure()).width).toBeGreaterThan(narrow + 100)
    })
  })
}
