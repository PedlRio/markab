import {
  codeFolding,
  foldable,
  foldedRanges,
  foldEffect,
  foldState,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/**
 * Obsidian-style folding: a chevron in the left margin of every heading (folds its whole
 * section, down to the next heading of the same or higher level) and of every list item
 * that has nested children. Hidden until the line is hovered; always shown when folded.
 *
 * The fold ranges themselves come from @codemirror/lang-markdown (heading sections and
 * list items) via `foldable()`.
 */

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

class FoldWidget extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly lineFrom: number,
  ) {
    super()
  }
  override eq(other: FoldWidget) {
    return other.folded === this.folded && other.lineFrom === this.lineFrom
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = `mk-fold-indicator${this.folded ? ' is-collapsed' : ''}`
    el.innerHTML = CHEVRON
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', this.folded ? 'Expand section' : 'Collapse section')
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleFoldAt(view, this.lineFrom)
    })
    return el
  }
  override ignoreEvent() {
    return true
  }
}

/** The folded range that starts at the end of this line, if any. */
function foldedAt(state: EditorState, lineTo: number) {
  let found: { from: number; to: number } | null = null
  foldedRanges(state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) found = { from, to }
  })
  return found as { from: number; to: number } | null
}

/** Only headings and list items get a chevron (paragraphs, quotes, code stay unfoldable). */
function isFoldTarget(state: EditorState, lineFrom: number, lineTo: number) {
  const text = state.doc.sliceString(lineFrom, lineTo)
  const start = lineFrom + (text.length - text.trimStart().length)
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(start, 1); node; node = node.parent) {
    if (node.from < lineFrom) break
    if (/^(ATX|Setext)Heading\d$/.test(node.name)) return true
    if (node.name === 'ListItem') return node.to > lineTo // only items with nested content
  }
  return false
}

export function toggleFoldAt(view: EditorView, lineFrom: number) {
  const { state } = view
  const line = state.doc.lineAt(lineFrom)
  const folded = foldedAt(state, line.to)
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) })
    return true
  }
  const range = foldable(state, line.from, line.to)
  if (range) view.dispatch({ effects: foldEffect.of(range) })
  return Boolean(range)
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const widgets: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      if (line.length && isFoldTarget(state, line.from, line.to)) {
        const folded = foldedAt(state, line.to)
        if (folded || foldable(state, line.from, line.to)) {
          widgets.push(
            Decoration.widget({ widget: new FoldWidget(Boolean(folded), line.from), side: -1 }).range(line.from),
          )
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(widgets)
}

const foldIndicators = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.state.field(foldState, false) !== u.startState.field(foldState, false)
      ) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ─── Persist folds per note, like Obsidian remembers them per file ─────────────

const foldKey = (noteId: string) => `markab:folds:${noteId}`

function saveFolds(noteId: string, state: EditorState) {
  const lines: number[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  try {
    if (lines.length) localStorage.setItem(foldKey(noteId), JSON.stringify(lines))
    else localStorage.removeItem(foldKey(noteId))
  } catch {
    // storage unavailable — folds just won't be remembered
  }
}

/** Re-apply the folds saved for this note (call once after the view is created). */
export function restoreFolds(view: EditorView, noteId: string) {
  let lines: number[] = []
  try {
    lines = JSON.parse(localStorage.getItem(foldKey(noteId)) ?? '[]') as number[]
  } catch {
    return
  }
  const { state } = view
  const effects = lines
    .filter((n) => n >= 1 && n <= state.doc.lines)
    .map((n) => {
      const line = state.doc.line(n)
      return foldable(state, line.from, line.to)
    })
    .filter((r): r is { from: number; to: number } => r !== null)
    .map((r) => foldEffect.of(r))
  if (effects.length) view.dispatch({ effects })
}

export function obsidianFolding(noteId: string): Extension {
  return [
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const el = document.createElement('span')
        el.className = 'mk-fold-placeholder'
        el.textContent = '…'
        el.title = 'Expand'
        el.addEventListener('click', onclick)
        return el
      },
    }),
    foldIndicators,
    EditorView.updateListener.of((u) => {
      if (u.state.field(foldState, false) !== u.startState.field(foldState, false)) saveFolds(noteId, u.state)
    }),
  ]
}

/** Fold every heading section (Obsidian's "Fold all headings and lists"). */
export function foldAllHeadings(view: EditorView) {
  const { state } = view
  const effects = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (!line.length || !isFoldTarget(state, line.from, line.to) || foldedAt(state, line.to)) continue
    const range = foldable(state, line.from, line.to)
    if (range) effects.push(foldEffect.of(range))
  }
  if (effects.length) view.dispatch({ effects })
}

export function unfoldEverything(view: EditorView) {
  const effects: ReturnType<typeof unfoldEffect.of>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }))
  })
  if (effects.length) view.dispatch({ effects })
}
