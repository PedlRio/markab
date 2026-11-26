import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions } from '@/editor/extensions'

let editor: Editor | undefined
const roundTrip = (md: string) => {
  editor = new Editor({ extensions: buildExtensions(), content: md, contentType: 'markdown' })
  return editor.getMarkdown().trim()
}

afterEach(() => editor?.destroy())

describe('markdown round-trip', () => {
  it.each([
    ['headings and emphasis', '# Title\n\nSome **bold**, *italic* and `code`.'],
    ['highlight', 'An ==important== word.'],
    ['task list', '- [ ] todo\n- [x] done'],
    ['bullet list', '- one\n- two'],
    ['ordered list', '1. one\n2. two'],
    ['link', 'See [docs](https://example.com).'],
    ['blockquote', '> quoted'],
    ['code block', '```js\nconst a = 1\n```'],
  ])('%s', (_name, md) => {
    expect(roundTrip(md)).toBe(md)
  })

  it('keeps a resized image width using Obsidian syntax', () => {
    expect(roundTrip('![cat|320](https://example.com/cat.png)')).toBe(
      '![cat|320](https://example.com/cat.png)',
    )
    expect(editor!.getJSON().content?.[0]?.attrs).toMatchObject({ alt: 'cat', width: 320 })
  })

  it('reads plain images written elsewhere', () => {
    expect(roundTrip('![a cat](https://example.com/cat.png)')).toBe(
      '![a cat](https://example.com/cat.png)',
    )
  })
})
