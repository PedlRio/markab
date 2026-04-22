import { useMemo, useState } from 'react'
import { useNoteStore } from '../../store/noteStore'
import type { Folder, Note } from '../../types'

function NoteItem({
  note,
  isActive,
  depth,
  onDragStart,
}: {
  note: Note
  isActive: boolean
  depth: number
  onDragStart: (id: string) => void
}) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote)
  const deleteNote = useNoteStore((s) => s.deleteNote)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/ntm-note', note.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(note.id)
      }}
      className={`group flex items-center justify-between pr-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => setActiveNote(note.id)}
      onKeyDown={(e) => e.key === 'Enter' && setActiveNote(note.id)}
    >
      <span className="text-sm truncate flex-1">{note.title || 'Untitled'}</span>
      <button
        className="opacity-0 group-hover:opacity-100 ml-2 w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-opacity rounded"
        onClick={(e) => {
          e.stopPropagation()
          deleteNote(note.id)
        }}
        aria-label="Delete note"
      >
        ×
      </button>
    </div>
  )
}

function FolderRow({
  folder,
  depth,
  open,
  onToggle,
  onDropNote,
  onRename,
  onDelete,
  onAddNote,
  onAddSubfolder,
}: {
  folder: Folder
  depth: number
  open: boolean
  onToggle: () => void
  onDropNote: (noteId: string, folderId: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onAddNote: (folderId: string) => void
  onAddSubfolder: (parentId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const [hover, setHover] = useState(false)

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/ntm-note')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setHover(true)
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        setHover(false)
        const id = e.dataTransfer.getData('application/ntm-note')
        if (id) onDropNote(id, folder.id)
      }}
      className={`group flex items-center gap-1 pr-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        hover ? 'bg-zinc-800/70 ring-1 ring-zinc-600' : 'hover:bg-zinc-900'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onToggle}
    >
      <span className="w-4 text-center text-zinc-600 text-xs select-none">{open ? '▾' : '▸'}</span>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            onRename(folder.id, name)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(folder.id, name)
              setEditing(false)
            }
            if (e.key === 'Escape') {
              setName(folder.name)
              setEditing(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-zinc-900 text-sm text-zinc-200 px-1 py-0.5 rounded outline-none border border-zinc-700"
        />
      ) : (
        <>
          <span
            className="text-sm truncate flex-1 text-zinc-300"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            {folder.name}
          </span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
            <button
              title="New note here"
              className="w-5 h-5 text-zinc-600 hover:text-zinc-200 rounded text-xs"
              onClick={(e) => {
                e.stopPropagation()
                onAddNote(folder.id)
              }}
            >
              +
            </button>
            <button
              title="New subfolder"
              className="w-5 h-5 text-zinc-600 hover:text-zinc-200 rounded text-[10px]"
              onClick={(e) => {
                e.stopPropagation()
                onAddSubfolder(folder.id)
              }}
            >
              ▸+
            </button>
            <button
              title="Delete folder"
              className="w-5 h-5 text-zinc-600 hover:text-red-400 rounded"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete folder "${folder.name}"? Notes inside move to root.`)) {
                  onDelete(folder.id)
                }
              }}
            >
              ×
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never'
  const delta = Date.now() - ts
  const s = Math.floor(delta / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export function Sidebar() {
  const notes = useNoteStore((s) => s.notes)
  const folders = useNoteStore((s) => s.folders)
  const activeNoteId = useNoteStore((s) => s.activeNoteId)
  const createNote = useNoteStore((s) => s.createNote)
  const moveNote = useNoteStore((s) => s.moveNote)
  const createFolder = useNoteStore((s) => s.createFolder)
  const renameFolder = useNoteStore((s) => s.renameFolder)
  const deleteFolder = useNoteStore((s) => s.deleteFolder)
  const vaultName = useNoteStore((s) => s.vaultName)
  const lastSyncedAt = useNoteStore((s) => s.lastSyncedAt)
  const syncError = useNoteStore((s) => s.syncError)
  const connectVault = useNoteStore((s) => s.connectVault)
  const disconnectVault = useNoteStore((s) => s.disconnectVault)
  const resyncVault = useNoteStore((s) => s.resyncVault)
  const isHidden = useNoteStore((s) => s.isHidden)
  const toggleHidden = useNoteStore((s) => s.toggleHidden)

  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rootHover, setRootHover] = useState(false)

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Folder[]>()
    for (const f of folders) {
      const k = f.parentId
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(f)
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return map
  }, [folders])

  const notesByFolder = useMemo(() => {
    const map = new Map<string | null, Note[]>()
    for (const n of notes) {
      const k = n.folderId
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(n)
    }
    return map
  }, [notes])

  const searchActive = search.trim().length > 0
  const searchResults = searchActive
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          n.content.toLowerCase().includes(search.toLowerCase()),
      )
    : []

  const toggleFolder = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleAddFolder = (parentId: string | null = null) => {
    const name = window.prompt('Folder name:', 'New Folder')
    if (!name) return
    createFolder(name, parentId)
    if (parentId) setExpanded((p) => new Set(p).add(parentId))
  }

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => {
    const isOpen = expanded.has(folder.id)
    const childFolders = childrenByParent.get(folder.id) ?? []
    const childNotes = notesByFolder.get(folder.id) ?? []
    return (
      <div key={folder.id}>
        <FolderRow
          folder={folder}
          depth={depth}
          open={isOpen}
          onToggle={() => toggleFolder(folder.id)}
          onDropNote={moveNote}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onAddNote={(fid) => {
            createNote(fid)
            setExpanded((p) => new Set(p).add(fid))
          }}
          onAddSubfolder={(pid) => handleAddFolder(pid)}
        />
        {isOpen && (
          <div>
            {childFolders.map((f) => renderFolder(f, depth + 1))}
            {childNotes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                isActive={n.id === activeNoteId}
                depth={depth + 1}
                onDragStart={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = childrenByParent.get(null) ?? []
  const rootNotes = notesByFolder.get(null) ?? []

  const handleConnect = async () => {
    setBusy(true)
    try {
      await connectVault()
    } finally {
      setBusy(false)
    }
  }

  const handleResync = async () => {
    setBusy(true)
    try {
      await resyncVault()
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(vaultName)

  return (
    <aside className="w-[260px] flex-shrink-0 border-r border-zinc-800 flex flex-col bg-[#0c0c0c]">
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between px-1">
          <h1 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            new-tab-mark
          </h1>
          <button
            onClick={toggleHidden}
            title={`${isHidden ? 'Reveal' : 'Hide'} notes (⌘⇧H)`}
            className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-200 rounded transition-colors"
            aria-label={isHidden ? 'Reveal notes' : 'Hide notes'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isHidden ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              ) : (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            className="flex-1 py-1.5 px-3 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-md transition-colors border border-zinc-700"
            onClick={() => createNote()}
          >
            + Note
          </button>
          <button
            className="flex-1 py-1.5 px-3 text-sm bg-transparent hover:bg-zinc-900 text-zinc-400 rounded-md transition-colors border border-zinc-800"
            onClick={() => handleAddFolder(null)}
            title="New folder"
          >
            + Folder
          </button>
        </div>
        <input
          type="search"
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-zinc-800 bg-zinc-900 text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
        />
      </div>

      <nav
        className={`flex-1 overflow-y-auto p-2 space-y-0.5 ${rootHover ? 'bg-zinc-900/30' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/ntm-note')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setRootHover(true)
          }
        }}
        onDragLeave={() => setRootHover(false)}
        onDrop={(e) => {
          setRootHover(false)
          const id = e.dataTransfer.getData('application/ntm-note')
          if (id) moveNote(id, null)
        }}
      >
        {searchActive ? (
          searchResults.length === 0 ? (
            <p className="text-xs text-zinc-600 px-2 py-6 text-center">No results</p>
          ) : (
            searchResults.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                isActive={n.id === activeNoteId}
                depth={0}
                onDragStart={() => {}}
              />
            ))
          )
        ) : notes.length === 0 && folders.length === 0 ? (
          <p className="text-xs text-zinc-600 px-2 py-6 text-center">No notes yet</p>
        ) : (
          <>
            {rootFolders.map((f) => renderFolder(f, 0))}
            {rootNotes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                isActive={n.id === activeNoteId}
                depth={0}
                onDragStart={() => {}}
              />
            ))}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-zinc-800 space-y-2">
        {connected ? (
          <>
            <div className="flex items-center gap-2 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-xs text-zinc-300 truncate flex-1" title={vaultName ?? ''}>
                {vaultName}
              </span>
            </div>
            <p className="text-[10px] text-zinc-600 px-1">
              Synced {formatRelative(lastSyncedAt)}
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={handleResync}
                disabled={busy}
                className="flex-1 py-1.5 px-2 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-md transition-colors border border-zinc-700"
              >
                {busy ? '…' : 'Resync'}
              </button>
              <button
                onClick={() => void disconnectVault()}
                disabled={busy}
                className="flex-1 py-1.5 px-2 text-xs bg-transparent hover:bg-zinc-900 disabled:opacity-50 text-zinc-500 rounded-md transition-colors border border-zinc-800"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="w-full py-1.5 px-3 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 rounded-md transition-colors border border-zinc-700"
            >
              {busy ? 'Connecting…' : 'Connect Obsidian Vault'}
            </button>
            <p className="text-xs text-zinc-700 text-center">Vault not connected</p>
          </>
        )}
        {syncError && (
          <p className="text-[10px] text-red-400 px-1 truncate" title={syncError}>
            {syncError}
          </p>
        )}
      </div>
    </aside>
  )
}
