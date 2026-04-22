import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Editor } from '@tiptap/react'

interface PaletteCommand {
  id: string
  label: string
  description: string
  shortcut: string
  execute: (editor: Editor) => void
}

const STATIC_COMMANDS: PaletteCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    shortcut: '# ',
    execute: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    shortcut: '## ',
    execute: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    shortcut: '### ',
    execute: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bold',
    label: 'Bold',
    description: 'Bold selected text',
    shortcut: '⌘B',
    execute: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'Italic',
    description: 'Italicise selected text',
    shortcut: '⌘I',
    execute: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    description: 'Cross out selected text',
    shortcut: '~~text~~',
    execute: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'Inline Code',
    description: 'Short inline code snippet',
    shortcut: '⌘E',
    execute: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code Block',
    description: 'Multi-line code block',
    shortcut: '``` ',
    execute: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'bulletList',
    label: 'Bullet List',
    description: 'Unordered list',
    shortcut: '- ',
    execute: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered List',
    description: 'Ordered numbered list',
    shortcut: '1. ',
    execute: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Task List',
    description: 'Checkbox checklist',
    shortcut: '- [ ]',
    execute: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    shortcut: '> ',
    execute: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'hr',
    label: 'Divider',
    description: 'Horizontal rule',
    shortcut: '---',
    execute: (e) => e.chain().focus().setHorizontalRule().run(),
  },
]

interface CommandPaletteProps {
  editor: Editor | null
  position: { x: number; y: number; slashRange?: { from: number; to: number } } | null
  onClose: () => void
  onLinkClick: () => void
}

export function CommandPalette({ editor, position, onClose, onLinkClick }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const allCommands = useMemo<PaletteCommand[]>(
    () => [
      ...STATIC_COMMANDS,
      {
        id: 'link',
        label: 'Link',
        description: 'Insert or edit hyperlink',
        shortcut: '⌘K',
        execute: () => {
          onClose()
          onLinkClick()
        },
      },
    ],
    [onClose, onLinkClick],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? allCommands.filter(
          (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
        )
      : allCommands
  }, [query, allCommands])

  // Focus input when palette opens
  useEffect(() => {
    if (!position) return
    setQuery('')
    setActiveIndex(0)
    const id = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(id)
  }, [position])

  // Reset active index on query change
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runCommand = useCallback(
    (cmd: PaletteCommand) => {
      const slashRange = position?.slashRange
      onClose()
      if (editor && slashRange) {
        editor.chain().focus().deleteRange(slashRange).run()
      }
      if (cmd.id === 'link') {
        onLinkClick()
        return
      }
      if (editor) cmd.execute(editor)
    },
    [editor, onClose, onLinkClick, position],
  )

  // Keyboard navigation (global, active only when palette is open)
  useEffect(() => {
    if (!position) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[activeIndex]
        if (cmd) runCommand(cmd)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [position, filtered, activeIndex, runCommand, onClose])

  // Click outside to close
  useEffect(() => {
    if (!position) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [position, onClose])

  if (!position) return null

  const paletteW = 300
  const left = Math.min(position.x, window.innerWidth - paletteW - 16)
  const top = position.y + 10

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden"
      style={{ left, top, width: paletteW }}
    >
      {/* Search input */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <span className="text-zinc-600 text-xs font-mono select-none">/</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter commands…"
          className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
        />
        <kbd className="text-zinc-700 text-xs font-mono">esc</kbd>
      </div>

      {/* Commands list */}
      <div ref={listRef} className="overflow-y-auto max-h-60 py-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-zinc-600 px-3 py-4 text-center">No commands match</p>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                i === activeIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                runCommand(cmd)
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <div className="min-w-0">
                <div className="text-sm text-zinc-200 font-medium leading-tight">{cmd.label}</div>
                <div className="text-xs text-zinc-500 leading-tight mt-0.5">{cmd.description}</div>
              </div>
              <span className="text-xs text-zinc-600 font-mono ml-3 flex-shrink-0">{cmd.shortcut}</span>
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-700 font-mono">↑↓ navigate · ↵ select · esc close</span>
      </div>
    </div>
  )
}
