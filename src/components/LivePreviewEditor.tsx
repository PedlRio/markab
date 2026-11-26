import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { foldAllHeadings, restoreFolds, unfoldEverything } from '@/editor-cm/folding'
import { buildCmExtensions, livePreviewOn, previewMode, sourceModeOn } from '@/editor-cm/setup'
import type { Note } from '@/lib/types'
import { useNotes } from '@/store/notes'
import { ViewHeader } from './ViewHeader'
import { useDebouncedSave } from './useDebouncedSave'

/**
 * The Obsidian-style editor: CodeMirror 6 over the raw Markdown, with Live Preview
 * decorations (see src/editor-cm). The text in the editor *is* the saved note.
 */
export function LivePreviewEditor({ note }: { note: Note }) {
  const updateNote = useNotes((s) => s.updateNote)
  const openNoteByTitle = useNotes((s) => s.openNoteByTitle)

  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lastSaved = useRef(note.content)
  const [title, setTitle] = useState(note.title)
  const titleFocused = useRef(false)
  const [livePreview, setLivePreview] = useState(true)
  const [stats, setStats] = useState(() => countWords(note.content))

  const saveContent = useDebouncedSave((content) => {
    lastSaved.current = content
    updateNote(note.id, { content })
  })
  const saveTitle = useDebouncedSave((value) => updateNote(note.id, { title: value }))
  const saveRef = useRef(saveContent)
  saveRef.current = saveContent
  const openNoteRef = useRef(openNoteByTitle)
  openNoteRef.current = openNoteByTitle

  // Create the editor once per note (the component is keyed by note id).
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: note.content,
        extensions: buildCmExtensions({
          noteId: note.id,
          livePreview: true,
          onChange: (md) => {
            saveRef.current(md)
            setStats(countWords(md))
          },
          links: {
            openExternal: (href) => window.open(href, '_blank', 'noopener'),
            openInternal: (target) => openNoteRef.current(target),
          },
        }),
      }),
    })
    view.current = v
    restoreFolds(v, note.id)
    return () => {
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The same note edited in another tab: take its version unless we're typing in it.
  useEffect(() => {
    const v = view.current
    if (!v || note.content === lastSaved.current || v.hasFocus) return
    if (note.content === v.state.doc.toString()) return
    lastSaved.current = note.content
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: note.content } })
  }, [note.content])

  useEffect(() => {
    if (!titleFocused.current) setTitle(note.title)
  }, [note.title])

  const toggleMode = () => {
    const next = !livePreview
    setLivePreview(next)
    view.current?.dispatch({ effects: previewMode.reconfigure(next ? livePreviewOn : sourceModeOn) })
    view.current?.focus()
  }


  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-(--background-primary)">
      <ViewHeader
        note={note}
        livePreview={livePreview}
        onToggleMode={toggleMode}
        onFoldAll={() => view.current && foldAllHeadings(view.current)}
        onUnfoldAll={() => view.current && unfoldEverything(view.current)}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto box-content w-full max-w-(--file-line-width) px-12 pb-2 pt-8">
          <input
            type="text"
            value={title}
            placeholder="Untitled"
            aria-label="Note title"
            autoFocus={!note.title && !note.content}
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => (titleFocused.current = false)}
            onChange={(e) => {
              setTitle(e.target.value)
              saveTitle(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault()
                const v = view.current
                if (v) {
                  v.focus()
                  v.dispatch({ selection: { anchor: 0 } })
                }
              }
            }}
            className="inline-title"
          />
        </div>
        <div ref={host} className="mk-cm-host flex-1" />
      </div>

      <footer className="pointer-events-none absolute bottom-0 right-0 flex gap-3 rounded-tl-md border-l border-t border-(--divider-color) bg-(--status-bar-background) px-3 py-1 text-[11px] text-(--text-muted)">
        <span>
          {stats.words} {stats.words === 1 ? 'word' : 'words'}
        </span>
        <span>{stats.chars} characters</span>
      </footer>
    </div>
  )
}

function countWords(md: string) {
  const text = md.trim()
  return { words: text ? text.split(/\s+/).length : 0, chars: md.length }
}
