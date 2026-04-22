import { useEffect } from 'react'
import { useNoteStore } from '../store/noteStore'
import { useEditorPrefs } from '../store/prefsStore'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { PrivacyOverlay } from './components/PrivacyOverlay'

export default function App() {
  const { notes, activeNoteId, isHydrated, hydrate } = useNoteStore()
  const hydratePrefs = useEditorPrefs((s) => s.hydrate)

  useEffect(() => {
    document.documentElement.classList.add('dark')
    void hydrate()
    void hydratePrefs()
  }, [hydrate, hydratePrefs])

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null

  if (!isHydrated) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-600 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <>
      <div className="h-screen flex bg-zinc-950 text-zinc-200">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {activeNote ? (
            <Editor key={activeNote.id} note={activeNote} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600">
              <p className="text-lg font-medium">No notes yet</p>
              <p className="text-sm">Create a new note to get started</p>
            </div>
          )}
        </main>
      </div>
      <PrivacyOverlay />
    </>
  )
}
