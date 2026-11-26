import { FileText, Plus, X } from 'lucide-react'
import { useNotes } from '@/store/notes'

/** Obsidian's tab strip. Markab keeps one tab (the open note); "+" starts a new note. */
export function TabBar() {
  const note = useNotes((s) => s.notes.find((n) => n.id === s.activeNoteId) ?? null)
  const setActiveNote = useNotes((s) => s.setActiveNote)
  const createNote = useNotes((s) => s.createNote)

  return (
    <div className="flex h-(--header-height) shrink-0 items-end gap-1 border-b border-(--divider-color) bg-(--tab-container-background) px-2">
      <div
        role="tab"
        aria-selected="true"
        className="relative -mb-px flex h-8 max-w-60 min-w-36 items-center gap-2 rounded-t-lg border border-b-0 border-(--divider-color) bg-(--tab-background-active) pl-3 pr-1.5 text-[13px] text-(--tab-text-color-active)"
      >
        <FileText size={14} strokeWidth={1.75} className="shrink-0 text-(--text-faint)" />
        <span className="flex-1 truncate">{note ? note.title.trim() || 'Untitled' : 'New tab'}</span>
        {note && (
          <button
            aria-label="Close tab"
            title="Close"
            onClick={() => setActiveNote(null)}
            className="rounded p-0.5 text-(--text-faint) hover:bg-(--background-modifier-hover) hover:text-(--text-normal)"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <button
        aria-label="New note"
        title="New note"
        onClick={() => createNote()}
        className="mb-1.5 rounded p-1 text-(--icon-color) hover:bg-(--background-modifier-hover) hover:text-(--icon-color-hover)"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
