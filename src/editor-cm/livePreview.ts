import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { IMAGE_EXT } from '@/lib/vault'
import { parseWikiTarget } from './syntax'
import {
  BulletWidget,
  CalloutTitleWidget,
  calloutFamily,
  CheckboxWidget,
  CodeLanguageWidget,
  EmbedImageWidget,
  HrWidget,
  ImageWidget,
} from './widgets'

/**
 * Obsidian-style Live Preview: the document stays plain Markdown, and syntax markers are
 * hidden (or swapped for widgets) everywhere except where the cursor is. Moving the cursor
 * into `**bold**` reveals the asterisks; moving away hides them again.
 *
 * Everything here is decorations over the Lezer syntax tree — the text is never rewritten,
 * so the saved Markdown is byte-for-byte what the user typed.
 */

const hide = Decoration.replace({})
const mark = (cls: string, attributes?: Record<string, string>) => Decoration.mark({ class: cls, attributes })
const line = (cls: string) => Decoration.line({ class: cls })

const CALLOUT_RE = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)\s*(.*)$/

class Builder {
  readonly ranges: Range<Decoration>[] = []
  readonly lineClasses = new Map<number, Set<string>>()

  constructor(
    readonly state: EditorState,
    readonly focused: boolean,
  ) {}

  /** True when any cursor/selection touches [from, to] (inclusive of both edges). */
  touches(from: number, to: number) {
    if (!this.focused) return false
    return this.state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  }

  touchesLine(pos: number) {
    const l = this.state.doc.lineAt(pos)
    return this.touches(l.from, l.to)
  }

  add(from: number, to: number, deco: Decoration) {
    if (from < to || (from === to && deco.spec.widget)) this.ranges.push(deco.range(from, to))
  }

  hide(from: number, to: number) {
    if (from < to) this.ranges.push(hide.range(from, to))
  }

  widget(from: number, to: number, widget: Decoration) {
    this.ranges.push(widget.range(from, to))
  }

  addLineClass(pos: number, cls: string) {
    const from = this.state.doc.lineAt(pos).from
    const set = this.lineClasses.get(from) ?? new Set<string>()
    set.add(cls)
    this.lineClasses.set(from, set)
  }

  /** Hide a marker plus one following space (e.g. `# `, `> `). */
  hideWithSpace(from: number, to: number) {
    const next = this.state.doc.sliceString(to, to + 1)
    this.hide(from, next === ' ' ? to + 1 : to)
  }

  finish(): DecorationSet {
    for (const [from, classes] of this.lineClasses) this.ranges.push(line([...classes].join(' ')).range(from))
    return Decoration.set(this.ranges, true)
  }
}

function eachLine(state: EditorState, from: number, to: number, fn: (lineFrom: number, lineTo: number, n: number) => void) {
  let pos = from
  let n = 0
  while (pos <= to) {
    const l = state.doc.lineAt(pos)
    fn(l.from, l.to, n++)
    if (l.to + 1 > to) break
    pos = l.to + 1
  }
}

const childrenOf = (node: SyntaxNodeRef, name: string) => {
  const out: { from: number; to: number }[] = []
  const cursor = node.node.cursor()
  if (cursor.firstChild()) {
    do {
      if (cursor.name === name) out.push({ from: cursor.from, to: cursor.to })
    } while (cursor.nextSibling())
  }
  return out
}

const INLINE_STYLES: Record<string, { cls: string; markName: string }> = {
  Emphasis: { cls: 'cm-em', markName: 'EmphasisMark' },
  StrongEmphasis: { cls: 'cm-strong', markName: 'EmphasisMark' },
  Strikethrough: { cls: 'cm-strikethrough', markName: 'StrikethroughMark' },
  Highlight: { cls: 'cm-highlight', markName: 'HighlightMark' },
  InlineCode: { cls: 'cm-inline-code', markName: 'CodeMark' },
}

function decorate(b: Builder, from: number, to: number) {
  const { state } = b
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const name = node.name

      // ── Headings ─────────────────────────────────────────────
      const heading = /^ATXHeading(\d)$/.exec(name)
      if (heading) {
        b.addLineClass(node.from, `HyperMD-header HyperMD-header-${heading[1]}`)
        b.add(node.from, node.to, mark(`cm-header cm-header-${heading[1]}`))
        if (!b.touchesLine(node.from)) {
          for (const m of childrenOf(node, 'HeaderMark')) {
            if (m.from === node.from) b.hideWithSpace(m.from, m.to)
            else b.hide(state.sliceDoc(m.from - 1, m.from) === ' ' ? m.from - 1 : m.from, m.to) // closing #s
          }
        }
        return
      }

      // ── Inline styles ────────────────────────────────────────
      const inline = INLINE_STYLES[name]
      if (inline) {
        b.add(node.from, node.to, mark(inline.cls))
        if (!b.touches(node.from, node.to)) {
          for (const m of childrenOf(node, inline.markName)) b.hide(m.from, m.to)
        } else {
          for (const m of childrenOf(node, inline.markName)) b.add(m.from, m.to, mark('cm-formatting'))
        }
        return
      }

      // ── Links ────────────────────────────────────────────────
      if (name === 'Link') {
        const marks = childrenOf(node, 'LinkMark')
        const url = childrenOf(node, 'URL')[0]
        if (marks.length >= 2) {
          const textFrom = marks[0]!.to
          const textTo = marks[1]!.from
          const href = url ? state.sliceDoc(url.from, url.to) : ''
          if (b.touches(node.from, node.to)) {
            b.add(textFrom, textTo, mark('cm-link'))
            if (url) b.add(url.from, url.to, mark('cm-url'))
          } else {
            b.hide(node.from, textFrom)
            b.add(textFrom, textTo, mark('cm-link external-link', { 'data-href': href }))
            b.hide(textTo, node.to)
          }
        }
        return
      }

      if (name === 'URL' && node.node.parent?.name !== 'Link' && node.node.parent?.name !== 'Image') {
        b.add(node.from, node.to, mark('cm-url external-link', { 'data-href': state.sliceDoc(node.from, node.to) }))
        return
      }

      if (name === 'WikiLink') {
        const inner = state.sliceDoc(node.from + 2, node.to - 2)
        const { target, label } = parseWikiTarget(inner)

        // `![[file.png]]` / `![[file.png|300]]`: an embedded attachment.
        const isEmbed = state.sliceDoc(node.from - 1, node.from) === '!'
        if (isEmbed && IMAGE_EXT.test(target)) {
          const from = node.from - 1
          if (b.touches(from, node.to)) {
            b.add(from, node.to, mark('cm-formatting cm-embed'))
          } else {
            const size = /\|(\d+)(?:x\d+)?$/.exec(inner)
            const name = inner.split('|')[0]!.trim()
            b.widget(from, node.to, Decoration.replace({ widget: new EmbedImageWidget(name, size ? Number(size[1]) : null) }))
          }
          return false
        }

        if (b.touches(node.from, node.to)) {
          b.add(node.from + 2, node.to - 2, mark('cm-hmd-internal-link'))
          b.add(node.from, node.from + 2, mark('cm-formatting'))
          b.add(node.to - 2, node.to, mark('cm-formatting'))
        } else {
          const pipe = inner.indexOf('|')
          const labelFrom = pipe >= 0 ? node.from + 2 + pipe + 1 : node.from + 2
          b.hide(node.from, labelFrom)
          b.add(labelFrom, node.to - 2, mark('cm-hmd-internal-link internal-link', { 'data-target': target, title: label }))
          b.hide(node.to - 2, node.to)
        }
        return false
      }

      if (name === 'Image') {
        if (b.touches(node.from, node.to)) return
        const url = childrenOf(node, 'URL')[0]
        const marks = childrenOf(node, 'LinkMark')
        if (!url || marks.length < 2) return
        const rawAlt = state.sliceDoc(marks[0]!.to, marks[1]!.from)
        const sized = /^(.*?)\|(\d+)$/.exec(rawAlt)
        b.widget(
          node.from,
          node.to,
          Decoration.replace({
            widget: new ImageWidget(state.sliceDoc(url.from, url.to), sized ? sized[1]! : rawAlt, sized ? Number(sized[2]) : null),
          }),
        )
        return false
      }

      // ── Lists and tasks ──────────────────────────────────────
      if (name === 'ListMark') {
        const item = node.node.parent
        const task = item?.getChild('Task')
        const isBullet = item?.parent?.name === 'BulletList'
        if (task) {
          const marker = task.getChild('TaskMarker')
          if (marker && !b.touches(node.from, marker.to)) b.hideWithSpace(node.from, node.to)
          else b.add(node.from, node.to, mark('cm-formatting cm-formatting-list'))
        } else if (isBullet && !b.touches(node.from, node.to + 1)) {
          b.widget(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }))
        } else {
          b.add(node.from, node.to, mark('cm-formatting cm-formatting-list'))
        }
        return
      }

      if (name === 'TaskMarker') {
        const checked = /\[[xX]\]/.test(state.sliceDoc(node.from, node.to))
        if (!b.touches(node.from, node.to)) {
          b.widget(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }))
        }
        if (checked) {
          const task = node.node.parent
          if (task && node.to + 1 < task.to) b.add(node.to + 1, task.to, mark('is-checked'))
        }
        return
      }

      if (name === 'BulletList' || name === 'OrderedList') {
        eachLine(state, node.from, node.to, (lf) => b.addLineClass(lf, 'HyperMD-list-line'))
        return
      }

      // ── Blockquotes and callouts ─────────────────────────────
      if (name === 'Blockquote') {
        const first = state.doc.lineAt(node.from)
        const callout = CALLOUT_RE.exec(first.text)
        const family = callout ? calloutFamily(callout[2]!) : null
        eachLine(state, node.from, node.to, (lf, lt, n) => {
          if (family) {
            b.addLineClass(lf, `mk-callout callout-${family}`)
            if (n === 0) b.addLineClass(lf, 'mk-callout-first')
            if (lt >= node.to) b.addLineClass(lf, 'mk-callout-last')
          } else {
            b.addLineClass(lf, 'HyperMD-quote')
          }
        })
        if (callout && !b.touchesLine(first.from)) {
          b.widget(
            first.from,
            first.to,
            Decoration.replace({ widget: new CalloutTitleWidget(callout[2]!.toLowerCase(), callout[4]!.trim()) }),
          )
        }
        return
      }

      if (name === 'QuoteMark') {
        const l = state.doc.lineAt(node.from)
        const isCalloutTitle = CALLOUT_RE.test(l.text) && l.from === state.doc.lineAt(node.node.parent?.from ?? node.from).from
        if (isCalloutTitle && !b.touchesLine(node.from)) return // replaced by the title widget
        if (!b.touchesLine(node.from)) b.hideWithSpace(node.from, node.to)
        else b.add(node.from, node.to, mark('cm-formatting cm-formatting-quote'))
        return
      }

      // ── Code blocks ──────────────────────────────────────────
      if (name === 'FencedCode') {
        const inside = b.touches(node.from, node.to)
        const firstLine = state.doc.lineAt(node.from)
        const lastLine = state.doc.lineAt(node.to)
        eachLine(state, node.from, node.to, (lf) => b.addLineClass(lf, 'HyperMD-codeblock HyperMD-codeblock-bg'))
        b.addLineClass(firstLine.from, 'HyperMD-codeblock-begin')
        b.addLineClass(lastLine.from, 'HyperMD-codeblock-end')
        if (!inside) {
          const info = childrenOf(node, 'CodeInfo')[0]
          const lang = info ? state.sliceDoc(info.from, info.to) : ''
          b.widget(firstLine.from, firstLine.to, Decoration.replace({ widget: new CodeLanguageWidget(lang) }))
          if (lastLine.number !== firstLine.number && /^\s*(```|~~~)/.test(lastLine.text)) {
            b.hide(lastLine.from, lastLine.to)
          }
        }
        return false
      }

      if (name === 'HorizontalRule') {
        if (!b.touchesLine(node.from)) {
          b.widget(node.from, node.to, Decoration.replace({ widget: new HrWidget() }))
        }
        return
      }

      return
    },
  })
}

function build(view: EditorView): DecorationSet {
  const b = new Builder(view.state, view.hasFocus)
  for (const { from, to } of view.visibleRanges) decorate(b, from, to)
  return b.finish()
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.focusChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      ) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
