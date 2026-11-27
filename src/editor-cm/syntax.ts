import { tags } from '@lezer/highlight'
import type { InlineContext, MarkdownConfig } from '@lezer/markdown'

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

/** Length of `[[…]]` starting at `pos`, or -1 when there is no valid one. */
function wikiLinkEnd(cx: InlineContext, pos: number): number {
  if (cx.char(pos) !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1
  const rest = cx.slice(pos + 2, cx.end)
  const close = rest.indexOf(']]')
  if (close <= 0 || /[[\]\n]/.test(rest.slice(0, close))) return -1
  return pos + 2 + close + 2
}

const wikiLinkElt = (cx: InlineContext, from: number, to: number) =>
  cx.elt('WikiLink', from, to, [
    cx.elt('WikiLinkMark', from, from + 2),
    cx.elt('WikiLinkTarget', from + 2, to - 2),
    cx.elt('WikiLinkMark', to - 2, to),
  ])

/**
 * Obsidian internal links `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, and embeds
 * `![[image.png|300]]` (an `Embed` wrapping the link). The embed parser must run before
 * CommonMark's Image, which would otherwise claim the `![`.
 */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget' },
    { name: 'Embed' },
    { name: 'EmbedMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Embed',
      parse(cx, next, pos) {
        if (next !== 33 /* ! */) return -1
        const end = wikiLinkEnd(cx, pos + 1)
        if (end < 0) return -1
        return cx.addElement(cx.elt('Embed', pos, end, [cx.elt('EmbedMark', pos, pos + 1), wikiLinkElt(cx, pos + 1, end)]))
      },
      before: 'Image',
    },
    {
      name: 'WikiLink',
      parse(cx, _next, pos) {
        const end = wikiLinkEnd(cx, pos)
        return end < 0 ? -1 : cx.addElement(wikiLinkElt(cx, pos, end))
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
