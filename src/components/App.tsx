import { FilePlus, Search } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { useNotes } from '@/store/notes'
import { usePrefs, WIDTH_OPTIONS } from '@/store/prefs'
import { useUi } from '@/store/ui'
import { Editor } from './Editor'
import { LivePreviewEditor } from './LivePreviewEditor'
import { PrivacyOverlay } from './PrivacyOverlay'
import { Ribbon } from './Ribbon'
import { SettingsModal } from './SettingsModal'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

/** Obsidian-style workspace: ribbon | left sidebar | tab + note. */
export function App() {
  const isHydrated = useNotes((s) => s.isHydrated)
  const activeNote = useNotes((s) => s.notes.find((n) => n.id === s.activeNoteId) ?? null)
  const engine = usePrefs((s) => s.editor)
  const fontSize = usePrefs((s) => s.fontSize)
  const widthId = usePrefs((s) => s.widthId)
  const width = WIDTH_OPTIONS.find((w) => w.id === widthId)?.value ?? null

  // Set on the same element as `.mk-theme`: theme tokens like --font-text-size are
  // computed from these where they're declared, so setting them lower in the tree has no effect.
  const prefsStyle = {
    '--mk-font-size': `${fontSize}px`,
    '--mk-content-width': width ? `${width}px` : '100%',
  } as CSSProperties

  useEffect(() => {
    void (async () => {
      const prefs = await usePrefs.getState().load()
      await useNotes.getState().hydrate({ hideOnOpen: prefs.hideOnOpen })
    })()
  }, [])

  if (!isHydrated) return <div className="mk-theme h-screen bg-(--background-primary)" />

  return (
    <div className="mk-theme flex h-screen overflow-hidden bg-(--background-primary) text-(--text-normal)" style={prefsStyle}>
      <Ribbon />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TabBar />
        <div className="min-h-0 flex-1">
          {activeNote ? (
            engine === 'livePreview' ? (
              <LivePreviewEditor key={activeNote.id} note={activeNote} />
            ) : (
              <Editor key={activeNote.id} note={activeNote} />
            )
          ) : (
            <EmptyTab />
          )}
        </div>
      </main>
      <SettingsModal />
      <PrivacyOverlay />
    </div>
  )
}

/** What Obsidian shows in an empty tab: a few quick actions. */
function EmptyTab() {
  const hasNotes = useNotes((s) => s.notes.length > 0)
  const createNote = useNotes((s) => s.createNote)
  const showSidebarTab = useUi((s) => s.showSidebarTab)
  const link =
    'flex items-center gap-2 rounded px-2 py-1 text-(--text-accent) transition-colors hover:bg-(--background-modifier-hover) hover:text-(--text-accent-hover)'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
      <p className="mb-2 text-lg text-(--text-muted)">{hasNotes ? 'No file is open' : 'No notes yet'}</p>
      <button className={link} onClick={() => createNote()}>
        <FilePlus size={15} /> {hasNotes ? 'Create new note' : 'Create your first note'}
      </button>
      {hasNotes && (
        <button className={link} onClick={() => showSidebarTab('search')}>
          <Search size={15} /> Search notes
        </button>
      )}
    </div>
  )
}
