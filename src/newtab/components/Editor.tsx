import { useRef, useCallback, useEffect, useState } from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import { Markdown } from 'tiptap-markdown'
import GlobalDragHandle from 'tiptap-extension-global-drag-handle'
import AutoJoiner from 'tiptap-extension-auto-joiner'
import { useNoteStore } from '../../store/noteStore'
import type { Note } from '../../types'
import { CommandPalette } from './CommandPalette'
import { ResizableImage } from '../extensions/ResizableImage'
import { TaskInputRules } from '../extensions/TaskInputRules'
import { SmilieReplacer } from '../extensions/SmilieReplacer'
import { ColorHighlighter } from '../extensions/ColorHighlighter'
import { compressImageFile } from '../../lib/image'
import { useEditorPrefs, WIDTH_OPTIONS } from '../../store/prefsStore'
import { TypographyPopover } from './TypographyPopover'

interface EditorProps {
  note: Note
}

interface MarkdownStorage {
  markdown: { getMarkdown: () => string }
}

type PalettePosition = {
  x: number
  y: number
  slashRange?: { from: number; to: number }
}

export function Editor({ note }: EditorProps) {
  const updateNote = useNoteStore((s) => s.updateNote)
  const contentDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleLinkRef = useRef<() => void>(() => {})
  const openPaletteRef = useRef<(pos: PalettePosition) => void>(() => {})

  const [palettePosition, setPalettePosition] = useState<PalettePosition | null>(null)
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const fontSize = useEditorPrefs((s) => s.fontSize)
  const widthId = useEditorPrefs((s) => s.widthId)
  const widthValue = WIDTH_OPTIONS.find((w) => w.id === widthId)?.value ?? 780

  useEffect(() => {
    openPaletteRef.current = setPalettePosition
  }, [])

  // Keep the drag handle visible when the cursor approaches it from the text,
  // overriding the library's premature `.hide` toggle.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const handle = document.querySelector<HTMLElement>('.drag-handle')
      if (!handle) return
      const rect = handle.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const withinY = e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4
      const withinX = e.clientX >= rect.left - 4 && e.clientX <= rect.right + 28
      if (withinY && withinX) {
        handle.classList.remove('hide')
        handle.style.pointerEvents = 'auto'
      }
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  const scheduleContentSave = useCallback(
    (id: string, content: string) => {
      if (contentDebounce.current) clearTimeout(contentDebounce.current)
      contentDebounce.current = setTimeout(() => updateNote(id, { content }), 800)
    },
    [updateNote],
  )

  const scheduleTitleSave = useCallback(
    (id: string, title: string) => {
      if (titleDebounce.current) clearTimeout(titleDebounce.current)
      titleDebounce.current = setTimeout(() => updateNote(id, { title }), 800)
    },
    [updateNote],
  )

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskInputRules,
      Typography,
      SmilieReplacer,
      ColorHighlighter,
      ResizableImage.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: "Start writing… (type '/' for commands)" }),
      Link.configure({ openOnClick: false, autolink: true }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      GlobalDragHandle.configure({
        dragHandleWidth: 20,
        scrollTreshold: 100,
        dragHandleSelector: '.drag-handle',
      }),
      AutoJoiner,
    ],
    content: note.content,
    editorProps: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))
        if (!imageItem) return false

        event.preventDefault()
        const file = imageItem.getAsFile()
        if (!file) return false

        void compressImageFile(file)
          .then((src) => {
            const imageNode = view.state.schema.nodes['image']
            if (!imageNode) return
            view.dispatch(view.state.tr.replaceSelectionWith(imageNode.create({ src })))
          })
          .catch(() => {})
        return true
      },
      handleKeyDown(view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === '/') {
          event.preventDefault()
          const coords = view.coordsAtPos(view.state.selection.from)
          openPaletteRef.current({ x: coords.left, y: coords.bottom })
          return true
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
          event.preventDefault()
          handleLinkRef.current()
          return true
        }
        if (
          event.key === '/' &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          view.state.selection.empty
        ) {
          queueMicrotask(() => {
            const { from } = view.state.selection
            const coords = view.coordsAtPos(from)
            openPaletteRef.current({
              x: coords.left,
              y: coords.bottom,
              slashRange: { from: from - 1, to: from },
            })
          })
          return false
        }
        return false
      },
    },
    onUpdate({ editor: e }) {
      const md = (e.storage as MarkdownStorage).markdown.getMarkdown()
      scheduleContentSave(note.id, md)
    },
  })

  const handleLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL:', previousUrl ?? 'https://')

    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().setLink({ href: url }).run()
  }, [editor])

  useEffect(() => {
    handleLinkRef.current = handleLink
  }, [handleLink])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const text = editor.getText()
      const trimmed = text.trim()
      const words = trimmed ? trimmed.split(/\s+/).length : 0
      setStats({ words, chars: text.length })
    }
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  const readingMinutes = Math.max(1, Math.ceil(stats.words / 200))

  return (
    <div
      className="h-full flex flex-col overflow-hidden relative"
      style={
        {
          '--ntm-font-size': `${fontSize}px`,
          '--ntm-content-width': widthValue === 0 ? '100%' : `${widthValue}px`,
        } as React.CSSProperties
      }
    >
      <TypographyPopover />
      <div className="px-8 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
        <div className="mx-auto" style={{ maxWidth: 'var(--ntm-content-width)' }}>
          <input
            type="text"
            defaultValue={note.title}
            placeholder="Untitled"
            onChange={(e) => scheduleTitleSave(note.id, e.target.value)}
            className="w-full text-2xl font-bold bg-transparent outline-none text-zinc-100 placeholder-zinc-700"
          />
        </div>
      </div>
      <EditorContent
        editor={editor}
        className="ntm-editor flex-1 overflow-y-auto pl-12 pr-8 py-6 pb-10"
      />
      <div className="absolute bottom-0 left-0 right-0 px-8 py-1.5 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm flex gap-4 text-[11px] text-zinc-600 font-mono pointer-events-none">
        <span>{stats.words} {stats.words === 1 ? 'word' : 'words'}</span>
        <span>{stats.chars} chars</span>
        <span>{readingMinutes} min read</span>
      </div>
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: e }) => e.isActive('link')}
          tippyOptions={{ placement: 'bottom', duration: 120 }}
        >
          <LinkBubble editor={editor} onEdit={handleLink} />
        </BubbleMenu>
      )}
      <CommandPalette
        editor={editor}
        position={palettePosition}
        onClose={() => setPalettePosition(null)}
        onLinkClick={handleLink}
      />
    </div>
  )
}

function LinkBubble({
  editor,
  onEdit,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>
  onEdit: () => void
}) {
  const href = editor.getAttributes('link').href as string | undefined
  if (!href) return null
  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg shadow-black/40 px-2 py-1 text-xs">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-blue-400 hover:text-blue-300 max-w-[240px] truncate"
        title={href}
      >
        {href}
      </a>
      <span className="text-zinc-700">·</span>
      <button
        onClick={onEdit}
        className="text-zinc-400 hover:text-zinc-100 px-1"
        aria-label="Edit link"
      >
        Edit
      </button>
      <button
        onClick={() => editor.chain().focus().unsetLink().run()}
        className="text-zinc-500 hover:text-red-400 px-1"
        aria-label="Remove link"
      >
        Unlink
      </button>
    </div>
  )
}
