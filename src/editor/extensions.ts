import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Typography from '@tiptap/extension-typography'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { ColorHighlighter } from './ColorHighlighter'
import { SmilieReplacer } from './SmilieReplacer'
import { TaskInputRules } from './TaskInputRules'

/**
 * Images keep their resized width in Markdown using Obsidian's syntax: `![alt|320](src)`.
 * Plain `![alt](src)` still parses, so notes written anywhere else load fine.
 */
export const MarkdownImage = Image.extend({
  parseMarkdown: (token, helpers) => {
    const text = String(token.text ?? '')
    const match = /^(.*?)\|(\d+)$/.exec(text)
    return helpers.createNode('image', {
      src: token.href,
      title: token.title || null,
      alt: match ? match[1] || null : text || null,
      width: match ? Number(match[2]) : null,
    })
  },
  renderMarkdown: (node) => {
    const attrs = node.attrs ?? {}
    const alt = String(attrs.alt ?? '')
    const label = attrs.width ? `${alt}|${Math.round(Number(attrs.width))}` : alt
    const title = attrs.title ? ` "${String(attrs.title)}"` : ''
    return `![${label}](${String(attrs.src ?? '')}${title})`
  },
})

/**
 * The full editor schema. Shared by the editor UI and the Markdown round-trip tests,
 * so what is tested is exactly what ships.
 *
 * Order matters: `TaskInputRules` must come after StarterKit so the bullet-list input
 * rule doesn't swallow `- ` before `[ ]` is typed.
 */
export function buildExtensions({ placeholder = '' }: { placeholder?: string } = {}) {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskInputRules,
    Typography,
    SmilieReplacer,
    ColorHighlighter,
    MarkdownImage.configure({
      allowBase64: true,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 80, minHeight: 40 },
    }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ]
}
