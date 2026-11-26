import { EditorView, WidgetType } from '@codemirror/view'

export class BulletWidget extends WidgetType {
  override eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'mk-list-bullet'
    span.setAttribute('aria-hidden', 'true')
    return span
  }
}

/** `[ ]` / `[x]` rendered as a real checkbox that edits the Markdown when clicked. */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super()
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'task-list-item-checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Mark task as not done' : 'Mark task as done')
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      // pos points at "[" — the state char sits right after it.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  override ignoreEvent() {
    return false
  }
}

export class HrWidget extends WidgetType {
  override eq() {
    return true
  }
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'mk-hr'
    return hr
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null,
  ) {
    super()
  }
  override eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width
  }
  toDOM() {
    const img = document.createElement('img')
    img.className = 'mk-image'
    img.src = this.src
    img.alt = this.alt
    if (this.width) img.width = this.width
    img.draggable = false
    return img
  }
}

export class CalloutTitleWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly title: string,
  ) {
    super()
  }
  override eq(other: CalloutTitleWidget) {
    return other.type === this.type && other.title === this.title
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'callout-title'
    const icon = document.createElement('span')
    icon.className = 'callout-icon'
    icon.textContent = CALLOUT_ICONS[this.type] ?? CALLOUT_ICONS.note!
    const text = document.createElement('span')
    text.className = 'callout-title-inner'
    text.textContent = this.title || this.type.charAt(0).toUpperCase() + this.type.slice(1)
    span.append(icon, text)
    return span
  }
}

export class CodeLanguageWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  override eq(other: CodeLanguageWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'mk-code-lang'
    span.textContent = this.lang
    return span
  }
}

const CALLOUT_ICONS: Record<string, string> = {
  note: '✎',
  info: 'ℹ',
  tip: '🔥',
  hint: '🔥',
  important: '🔥',
  success: '✓',
  check: '✓',
  done: '✓',
  question: '?',
  help: '?',
  faq: '?',
  warning: '⚠',
  caution: '⚠',
  attention: '⚠',
  failure: '✗',
  fail: '✗',
  missing: '✗',
  danger: '⚡',
  error: '⚡',
  bug: '🐞',
  example: '☰',
  quote: '❝',
  cite: '❝',
  abstract: '☰',
  summary: '☰',
  tldr: '☰',
  todo: '☑',
}

/** Maps any callout type to the colour family Obsidian groups it under. */
export function calloutFamily(type: string): string {
  const t = type.toLowerCase()
  if (['abstract', 'summary', 'tldr'].includes(t)) return 'abstract'
  if (['tip', 'hint', 'important'].includes(t)) return 'tip'
  if (['success', 'check', 'done'].includes(t)) return 'success'
  if (['question', 'help', 'faq'].includes(t)) return 'question'
  if (['warning', 'caution', 'attention'].includes(t)) return 'warning'
  if (['failure', 'fail', 'missing'].includes(t)) return 'failure'
  if (['danger', 'error'].includes(t)) return 'danger'
  if (['quote', 'cite'].includes(t)) return 'quote'
  if (['info', 'todo', 'bug', 'example'].includes(t)) return t
  return 'note'
}
