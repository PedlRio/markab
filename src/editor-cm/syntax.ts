import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

/** Obsidian's `==highlight==`, parsed with the same flanking rules as GFM `~~strike~~`. */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.special(tags.content) } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        const pBefore = PUNCTUATION.test(before)
        const pAfter = PUNCTUATION.test(after)
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        )
      },
      after: 'Emphasis',
    },
  ],
}

/** Obsidian internal links: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`. */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget' },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1
        const rest = cx.slice(pos + 2, cx.end)
        const close = rest.indexOf(']]')
        if (close <= 0) return -1
        const inner = rest.slice(0, close)
        if (/[[\]\n]/.test(inner)) return -1
        const end = pos + 2 + close + 2
        return cx.addElement(
          cx.elt('WikiLink', pos, end, [
            cx.elt('WikiLinkMark', pos, pos + 2),
            cx.elt('WikiLinkTarget', pos + 2, end - 2),
            cx.elt('WikiLinkMark', end - 2, end),
          ]),
        )
      },
      before: 'Link',
    },
  ],
}

/** `target|alias` → what Obsidian displays and where it links. */
export function parseWikiTarget(inner: string): { target: string; label: string } {
  const pipe = inner.indexOf('|')
  const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
  const label = pipe >= 0 ? inner.slice(pipe + 1).trim() : target
  return { target: target.split('#')[0]!.trim() || target, label: label || target }
}
