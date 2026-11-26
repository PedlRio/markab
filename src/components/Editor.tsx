import DragHandle from '@tiptap/extension-drag-handle-react'
import { EditorContent, useEditor, useEditorState, type Editor as TiptapEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@tiptap/pm/view'
import { buildExtensions } from '@/editor/extensions'
import { compressImageFile } from '@/lib/image'
import type { Note } from '@/lib/types'
import { useNotes } from '@/store/notes'
import { CommandPalette, type PalettePosition } from './CommandPalette'
import { useDebouncedSave } from './useDebouncedSave'

function insertImages(editor: TiptapEditor, files: File[], pos?: number) {
  for (const file of files) {
    void compressImageFile(file)
      .then((src) => {
        const chain = editor.chain().focus()
        if (pos !== undefined) chain.insertContentAt(pos, { type: 'image', attrs: { src } })
        else chain.setImage({ src })
        chain.run()
      })
      .catch(() => {})
  }
}

const imageFiles = (list: FileList | null | undefined) =>
  Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))

export function Editor({ note }: { note: Note }) {
  const updateNote = useNotes((s) => s.updateNote)

  const [palette, setPalette] = useState<PalettePosition | null>(null)
  const [title, setTitle] = useState(note.title)
  const titleFocused = useRef(false)
  const lastSavedContent = useRef(note.content)

  const saveContent = useDebouncedSave((content) => {
    lastSavedContent.current = content
    updateNote(note.id, { content })
  })
  const saveTitle = useDebouncedSave((value) => updateNote(note.id, { title: value }))

  // Refs let ProseMirror's (static) editorProps reach the latest React callbacks.
  const openPalette = useRef(setPalette)
  const promptLinkRef = useRef<() => void>(() => {})
  const saveContentRef = useRef(saveContent)
  saveContentRef.current = saveContent
  const editorRef = useRef<TiptapEditor | null>(null)

  // Built once per note. useEditor re-applies options whenever any of them changes
  // identity, and re-applying mid-typing makes ProseMirror drop keystrokes — so nothing
  // in here may change between renders (`key={note.id}` remounts for a new note).
  const [options] = useState(() => ({
    extensions: buildExtensions({ placeholder: "Start writing… type '/' for commands" }),
    content: note.content,
    contentType: 'markdown' as const,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { spellcheck: 'true', 'aria-label': 'Note content' },
      handlePaste(view: EditorView, event: ClipboardEvent) {
        const files = imageFiles(event.clipboardData?.files)
        if (!files.length) return false
        event.preventDefault()
        insertImages(editorRef.current!, files, view.state.selection.from)
        return true
      },
      handleDrop(view: EditorView, event: DragEvent) {
        const files = imageFiles(event.dataTransfer?.files)
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertImages(editorRef.current!, files, pos)
        return true
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        const mod = event.metaKey || event.ctrlKey
        if (mod && event.key === '/') {
          event.preventDefault()
          const c = view.coordsAtPos(view.state.selection.from)
          openPalette.current({ x: c.left, y: c.bottom })
          return true
        }
        if (mod && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          promptLinkRef.current()
          return true
        }
        return false
      },
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (text !== '/' || from !== to) return false
        // Only at the start of a word, so typing a URL or "a/b" doesn't pop the palette.
        const charBefore = view.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\n')
        if (charBefore && !/\s/.test(charBefore)) return false
        // Insert the "/" ourselves so we know exactly where it is; the chosen command deletes it.
        view.dispatch(view.state.tr.insertText('/', from, to))
        const c = view.coordsAtPos(from + 1)
        openPalette.current({ x: c.left, y: c.bottom, slashRange: { from, to: from + 1 } })
        return true
      },
    },
    onUpdate: ({ editor: e }: { editor: TiptapEditor }) => saveContentRef.current(e.getMarkdown()),
  }))
  const editor = useEditor(options)
  editorRef.current = editor

  const promptLink = useCallback(() => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL (leave empty to remove):', previous ?? 'https://')
    if (url === null) return
    if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }, [editor])
  promptLinkRef.current = promptLink

  // The same note edited in another tab: take its version unless we're typing in it.
  useEffect(() => {
    if (note.content === lastSavedContent.current) return
    if (editor.isFocused) return
    if (note.content === editor.getMarkdown()) return
    lastSavedContent.current = note.content
    editor.commands.setContent(note.content, { contentType: 'markdown', emitUpdate: false })
  }, [editor, note.content])

  useEffect(() => {
    if (!titleFocused.current) setTitle(note.title)
  }, [note.title])

  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const text = e.getText()
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      return { words, chars: text.length }
    },
  })


  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-800 px-12 pb-4 pt-6">
        <input
          type="text"
          // A brand-new note starts in the title. Done here, synchronously, rather than
          // with Tiptap's delayed autofocus, which could steal focus mid-typing.
          autoFocus={!note.title && !note.content}
          value={title}
          placeholder="Untitled"
          aria-label="Note title"
          onFocus={() => (titleFocused.current = true)}
          onBlur={() => (titleFocused.current = false)}
          onChange={(e) => {
            setTitle(e.target.value)
            saveTitle(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              editor.commands.focus('start')
            }
          }}
          className="mx-auto block w-full max-w-(--mk-content-width) bg-transparent text-2xl font-bold text-zinc-100 outline-none placeholder:text-zinc-700"
        />
      </div>

      <div className="mk-editor flex-1 overflow-y-auto px-12 pb-16 pt-6">
        <DragHandle editor={editor}>
          <div className="mk-drag-handle" aria-hidden />
        </DragHandle>
        <EditorContent editor={editor} />
      </div>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex gap-4 border-t border-zinc-800 bg-zinc-950/80 px-8 py-1.5 font-mono text-[11px] text-zinc-600 backdrop-blur-sm">
        <span>
          {stats.words} {stats.words === 1 ? 'word' : 'words'}
        </span>
        <span>{stats.chars} chars</span>
        <span>{Math.max(1, Math.ceil(stats.words / 200))} min read</span>
      </footer>

      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: e }) => e.isActive('link')}
        options={{ placement: 'bottom' }}
      >
        <LinkBubble editor={editor} onEdit={promptLink} />
      </BubbleMenu>

      <CommandPalette
        editor={editor}
        position={palette}
        onClose={() => setPalette(null)}
        onLink={promptLink}
      />
    </div>
  )
}

function LinkBubble({ editor, onEdit }: { editor: TiptapEditor; onEdit: () => void }) {
  const href = useEditorState({
    editor,
    selector: ({ editor: e }) => e.getAttributes('link').href as string | undefined,
  })
  if (!href) return null
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg shadow-black/40">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="max-w-60 truncate text-blue-400 hover:text-blue-300"
        title={href}
      >
        {href}
      </a>
      <span className="text-zinc-700">·</span>
      <button onClick={onEdit} className="px-1 text-zinc-400 hover:text-zinc-100">
        Edit
      </button>
      <button
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
        className="px-1 text-zinc-500 hover:text-red-400"
      >
        Unlink
      </button>
    </div>
  )
}
