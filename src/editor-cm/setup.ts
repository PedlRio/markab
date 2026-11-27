import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { foldKeymap, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorSelection, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder, type Command } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { GFM } from '@lezer/markdown'
import { compressImageFile } from '@/lib/image'
import { obsidianFolding } from './folding'
import { livePreview } from './livePreview'
import { attachmentResolver, type AttachmentResolver } from './widgets'
import { Highlight, WikiLink } from './syntax'

/** Code-block colours, read from the same `--code-*` variables Obsidian themes define. */
const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-value)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--code-tag)' },
  { tag: [t.operator], color: 'var(--code-operator)' },
  { tag: [t.punctuation, t.bracket], color: 'var(--code-punctuation)' },
])

/** Wrap the selection (or the word at the cursor) in a marker, or unwrap it if already wrapped. */
const toggleWrap =
  (marker: string): Command =>
  (view) => {
    const { state } = view
    const changes = state.changeByRange((range) => {
      const n = marker.length
      const before = state.sliceDoc(range.from - n, range.from)
      const after = state.sliceDoc(range.to, range.to + n)
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - n, to: range.from, insert: '' },
            { from: range.to, to: range.to + n, insert: '' },
          ],
          range: EditorSelection.range(range.from - n, range.to - n),
        }
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + n, range.to + n),
      }
    })
    view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }

const insertLink: Command = (view) => {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const isUrl = /^https?:\/\/\S+$/.test(text)
    const insert = isUrl ? `[](${text})` : `[${text}]()`
    // Leave the cursor where the user types next: the label for a URL, the URL otherwise.
    const cursor = isUrl ? range.from + 1 : range.from + text.length + 3
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) }
  })
  view.dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

/** Cycles a line through: plain → "- [ ] " → "- [x] " → plain, like Obsidian's ⌘L. */
const toggleTask: Command = (view) => {
  const { state } = view
  const lineNo = state.doc.lineAt(state.selection.main.head)
  const text = lineNo.text
  const m = /^(\s*)(?:[-*+] )?(\[[ xX]\] )?/.exec(text)!
  const indent = m[1] ?? ''
  let next: string
  if (/^\s*[-*+] \[ \] /.test(text)) next = text.replace(/\[ \]/, '[x]')
  else if (/^\s*[-*+] \[[xX]\] /.test(text)) next = indent + text.replace(/^\s*[-*+] \[[xX]\] /, '')
  else if (/^\s*[-*+] /.test(text)) next = text.replace(/^(\s*[-*+] )/, '$1[ ] ')
  else next = `${indent}- [ ] ${text.slice(indent.length)}`
  view.dispatch({ changes: { from: lineNo.from, to: lineNo.to, insert: next }, userEvent: 'input' })
  return true
}

const obsidianKeymap = keymap.of([
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-Shift-x', run: toggleWrap('~~') },
  { key: 'Mod-e', run: toggleWrap('`') },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-l', run: toggleTask },
  { key: 'Tab', run: indentMore, shift: indentLess },
])

export interface LinkHandlers {
  openExternal: (href: string) => void
  openInternal: (target: string) => void
}

/** Clicking a rendered link follows it, as in Obsidian's Live Preview. */
const linkClicks = (handlers: LinkHandlers) =>
  EditorView.domEventHandlers({
    mousedown(event) {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-href], [data-target]')
      if (!el || event.button !== 0) return false
      event.preventDefault()
      if (el.dataset.href) handlers.openExternal(el.dataset.href)
      else if (el.dataset.target) handlers.openInternal(el.dataset.target)
      return true
    },
  })

export interface AttachmentHandlers {
  /** Store the file in the vault and return the name to embed, or null to embed it inline. */
  save: (file: File) => Promise<string | null>
  resolve: AttachmentResolver
}

/**
 * Pasted or dropped images: with a vault, saved as a file there and embedded as
 * `![[Pasted image ….png]]` (exactly what Obsidian does); without one, inlined as a
 * compressed data URL so the note still keeps the picture.
 */
function imageInput(attachments: AttachmentHandlers | undefined) {
  const insert = (view: EditorView, files: File[], at?: number) => {
    void (async () => {
      for (const file of files) {
        const name = attachments ? await attachments.save(file).catch(() => null) : null
        const text = name ? `![[${name}]]` : `![](${await compressImageFile(file)})`
        const pos = at ?? view.state.selection.main.from
        const to = at ?? view.state.selection.main.to
        view.dispatch({
          changes: { from: pos, to, insert: text },
          selection: { anchor: pos + text.length },
          userEvent: 'input.paste',
        })
        at = at === undefined ? undefined : pos + text.length
      }
    })()
  }
  const images = (list: FileList | undefined | null) =>
    Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = images(event.clipboardData?.files)
      if (!files.length) return false
      event.preventDefault()
      insert(view, files)
      return true
    },
    drop(event, view) {
      const files = images(event.dataTransfer?.files)
      if (!files.length) return false
      event.preventDefault()
      insert(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined)
      return true
    },
  })
}

/** Live Preview ⇄ Source mode, swapped at runtime without rebuilding the editor. */
export const previewMode = new Compartment()
export const livePreviewOn: Extension = [livePreview, EditorView.editorAttributes.of({ class: 'is-live-preview' })]
export const sourceModeOn: Extension = EditorView.editorAttributes.of({ class: 'is-source-mode' })

export function buildCmExtensions(opts: {
  noteId: string
  onChange: (markdown: string) => void
  links: LinkHandlers
  livePreview: boolean
  attachments?: AttachmentHandlers
}): Extension[] {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [GFM, Highlight, WikiLink],
    }),
    syntaxHighlighting(codeHighlight),
    previewMode.of(opts.livePreview ? livePreviewOn : sourceModeOn),
    obsidianKeymap,
    obsidianFolding(opts.noteId),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
    placeholder('Start writing…'),
    linkClicks(opts.links),
    imageInput(opts.attachments),
    ...(opts.attachments ? [attachmentResolver.of(opts.attachments.resolve)] : []),
    EditorView.contentAttributes.of({ 'aria-label': 'Note content', spellcheck: 'true' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString())
    }),
  ]
}
