import {
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  Files,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
  Vault,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Folder, Note } from '@/lib/types'
import { useNotes } from '@/store/notes'
import { useUi } from '@/store/ui'
import { ClickableIcon, useMenu, type MenuEntry } from './ui'

const NOTE_MIME = 'application/x-markab-note'
const acceptsNote = (e: DragEvent) => e.dataTransfer.types.includes(NOTE_MIME)
const noteTitle = (n: Note) => n.title.trim() || 'Untitled'

type SortOrder = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc' | 'created-desc' | 'created-asc'
const SORT_KEY = 'markab:sort'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'File name (A to Z)',
  'name-desc': 'File name (Z to A)',
  'modified-desc': 'Modified time (new to old)',
  'modified-asc': 'Modified time (old to new)',
  'created-desc': 'Created time (new to old)',
  'created-asc': 'Created time (old to new)',
}
const sorters: Record<SortOrder, (a: Note, b: Note) => number> = {
  'name-asc': (a, b) => noteTitle(a).localeCompare(noteTitle(b)),
  'name-desc': (a, b) => noteTitle(b).localeCompare(noteTitle(a)),
  'modified-desc': (a, b) => b.updatedAt - a.updatedAt,
  'modified-asc': (a, b) => a.updatedAt - b.updatedAt,
  'created-desc': (a, b) => b.createdAt - a.createdAt,
  'created-asc': (a, b) => a.createdAt - b.createdAt,
}
const loadSort = (): SortOrder => {
  try {
    const v = localStorage.getItem(SORT_KEY) as SortOrder | null
    return v && v in sorters ? v : 'name-asc'
  } catch {
    return 'name-asc'
  }
}

/** Inline rename field used for notes and folders (Obsidian renames in place). */
function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  useEffect(() => ref.current?.select(), [])
  return (
    <input
      ref={ref}
      autoFocus
      value={value}
      aria-label="Rename"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded border border-(--interactive-accent) bg-(--background-modifier-form-field) px-1 text-(--text-normal) outline-none"
    />
  )
}

function FileExplorer() {
  const notes = useNotes((s) => s.notes)
  const folders = useNotes((s) => s.folders)
  const activeNoteId = useNotes((s) => s.activeNoteId)
  const { createNote, createFolder, moveNote, renameFolder, deleteFolder, deleteNote, updateNote, setActiveNote } =
    useNotes.getState()

  const [sort, setSort] = useState<SortOrder>(loadSort)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const menu = useMenu()

  // Reveal the active note in the tree (expand its ancestors), like Obsidian.
  useEffect(() => {
    const note = notes.find((n) => n.id === activeNoteId)
    if (!note?.folderId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let id: string | null = note.folderId
      while (id && !next.has(id)) {
        next.add(id)
        id = folders.find((f) => f.id === id)?.parentId ?? null
      }
      return next.size === prev.size ? prev : next
    })
  }, [activeNoteId, notes, folders])

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, Folder[]>()
    for (const f of folders) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f])
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return map
  }, [folders])

  const notesByFolder = useMemo(() => {
    const map = new Map<string | null, Note[]>()
    for (const n of notes) map.set(n.folderId, [...(map.get(n.folderId) ?? []), n])
    for (const list of map.values()) list.sort(sorters[sort])
    return map
  }, [notes, sort])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const newFolder = (parentId: string | null) => {
    const id = createFolder('Untitled', parentId)
    setExpanded((prev) => {
      const next = new Set(prev).add(id)
      if (parentId) next.add(parentId)
      return next
    })
    setRenaming(id)
  }

  const newNote = (folderId: string | null) => {
    createNote(folderId)
    if (folderId) setExpanded((prev) => new Set(prev).add(folderId))
  }

  const changeSort = (order: SortOrder) => {
    setSort(order)
    try {
      localStorage.setItem(SORT_KEY, order)
    } catch {
      // ignore
    }
  }

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!acceptsNote(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(folderId ?? 'root')
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.stopPropagation()
      setDropTarget(null)
      const id = e.dataTransfer.getData(NOTE_MIME)
      if (id) moveNote(id, folderId)
    },
  })

  const itemClass = (active: boolean) =>
    `group flex cursor-pointer items-center gap-1 rounded py-[3px] pr-2 text-(--nav-item-size) leading-normal transition-colors ${
      active
        ? 'bg-(--nav-item-background-active) text-(--nav-item-color-active)'
        : 'text-(--nav-item-color) hover:bg-(--nav-item-background-hover) hover:text-(--nav-item-color-hover)'
    }`

  const renderNote = (note: Note): ReactNode => (
    <div
      key={note.id}
      draggable={renaming !== note.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_MIME, note.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => setActiveNote(note.id)}
      onContextMenu={(e) =>
        menu.open(e, [
          { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(note.id) },
          'separator',
          {
            label: 'Delete',
            icon: Trash2,
            danger: true,
            onSelect: () => {
              if (window.confirm(`Delete "${noteTitle(note)}"? This can't be undone.`)) deleteNote(note.id)
            },
          },
        ])
      }
      className={`${itemClass(note.id === activeNoteId)} pl-6`}
      title={noteTitle(note)}
    >
      {renaming === note.id ? (
        <RenameInput
          initial={note.title}
          onDone={(value) => {
            if (value !== null && value.trim()) updateNote(note.id, { title: value.trim() })
            setRenaming(null)
          }}
        />
      ) : (
        <span data-testid="note-row" className={`truncate ${note.title.trim() ? '' : 'italic opacity-70'}`}>
          {noteTitle(note)}
        </span>
      )}
    </div>
  )

  const renderFolder = (folder: Folder): ReactNode => {
    const open = expanded.has(folder.id)
    const items: MenuEntry[] = [
      { label: 'New note', icon: FilePlus, onSelect: () => newNote(folder.id) },
      { label: 'New folder', icon: FolderPlus, onSelect: () => newFolder(folder.id) },
      'separator',
      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(folder.id) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (window.confirm(`Delete folder "${folder.name}"? Its notes move to the top level.`)) deleteFolder(folder.id)
        },
      },
    ]
    return (
      <div key={folder.id}>
        <div
          {...dropProps(folder.id)}
          onClick={() => toggle(folder.id)}
          onContextMenu={(e) => menu.open(e, items)}
          className={`${itemClass(false)} pl-1 ${dropTarget === folder.id ? 'ring-1 ring-(--interactive-accent)' : ''}`}
        >
          <span className="flex w-5 shrink-0 justify-center text-(--text-faint)">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          {renaming === folder.id ? (
            <RenameInput
              initial={folder.name}
              onDone={(value) => {
                if (value !== null) renameFolder(folder.id, value)
                setRenaming(null)
              }}
            />
          ) : (
            <span className="truncate" data-testid="folder-name">
              {folder.name}
            </span>
          )}
        </div>
        {open && (
          // Obsidian's indentation guide: children sit in a container with a faint left rule.
          <div className="ml-[11px] border-l border-(--nav-indentation-guide-color) pl-1.5">
            {(foldersByParent.get(folder.id) ?? []).map(renderFolder)}
            {(notesByFolder.get(folder.id) ?? []).map(renderNote)}
          </div>
        )}
      </div>
    )
  }

  const allExpanded = folders.length > 0 && folders.every((f) => expanded.has(f.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-center gap-0.5 px-2 py-1.5">
        <ClickableIcon icon={FilePlus} label="New note" onClick={() => newNote(null)} size={16} />
        <ClickableIcon icon={FolderPlus} label="New folder" onClick={() => newFolder(null)} size={16} />
        <ClickableIcon
          icon={ArrowUpNarrowWide}
          label="Change sort order"
          size={16}
          onClick={(e) =>
            menu.open(
              e,
              (Object.keys(SORT_LABELS) as SortOrder[]).map((order) => ({
                label: `${sort === order ? '✓ ' : '    '}${SORT_LABELS[order]}`,
                onSelect: () => changeSort(order),
              })),
            )
          }
        />
        <ClickableIcon
          icon={allExpanded ? ChevronsDownUp : ChevronsUpDown}
          label={allExpanded ? 'Collapse all' : 'Expand all'}
          size={16}
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(folders.map((f) => f.id)))}
        />
      </div>
      <div
        className={`min-h-0 flex-1 overflow-y-auto px-2 pb-4 ${dropTarget === 'root' ? 'bg-(--background-modifier-active-hover)' : ''}`}
        {...dropProps(null)}
        onContextMenu={(e) =>
          menu.open(e, [
            { label: 'New note', icon: FilePlus, onSelect: () => newNote(null) },
            { label: 'New folder', icon: FolderPlus, onSelect: () => newFolder(null) },
          ])
        }
      >
        {(foldersByParent.get(null) ?? []).map(renderFolder)}
        {(notesByFolder.get(null) ?? []).map(renderNote)}
        {notes.length === 0 && folders.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-(--text-faint)">No notes yet</p>
        )}
      </div>
      {menu.element}
    </div>
  )
}

/** Snippet of `text` around the first match, with the match marked. */
function snippet(text: string, query: string): ReactNode {
  const i = text.toLowerCase().indexOf(query)
  if (i < 0) return null
  const start = Math.max(0, i - 40)
  const end = Math.min(text.length, i + query.length + 60)
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark className="rounded-sm bg-(--text-highlight-bg) text-(--text-normal)">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length, end)}
      {end < text.length && '…'}
    </>
  )
}

function SearchPane() {
  const notes = useNotes((s) => s.notes)
  const setActiveNote = useNotes((s) => s.setActiveNote)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const results = q
    ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-(--background-modifier-form-field) px-2 focus-within:ring-1 focus-within:ring-(--interactive-accent)">
          <Search size={14} className="text-(--text-faint)" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="w-full bg-transparent py-1.5 text-[13px] text-(--text-normal) outline-none placeholder:text-(--text-faint)"
          />
        </div>
        {q && (
          <p className="mt-2 text-[11px] text-(--text-faint)">
            {results.length} result{results.length === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {results.map((n) => (
          <button
            key={n.id}
            onClick={() => setActiveNote(n.id)}
            className="block w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-(--nav-item-background-hover)"
          >
            <div data-testid="note-row" className="truncate text-[13px] text-(--text-normal)">
              {noteTitle(n)}
            </div>
            {snippet(n.content, q) && (
              <div className="mt-0.5 line-clamp-2 text-xs text-(--text-muted)">{snippet(n.content, q)}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Bottom-left vault switcher: shows the connected Obsidian vault (or "Markab"). */
function VaultSwitcher() {
  const status = useNotes((s) => s.vaultStatus)
  const vaultName = useNotes((s) => s.vaultName)
  const { connectVault, reauthorizeVault, resyncVault, disconnectVault } = useNotes.getState()
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const menu = useMenu()

  const vaultItems: MenuEntry[] =
    status === 'disconnected'
      ? [{ label: 'Connect Obsidian vault…', icon: Vault, onSelect: () => void connectVault() }]
      : [
          status === 'connected'
            ? { label: 'Resync vault', icon: RefreshCw, onSelect: () => void resyncVault() }
            : { label: 'Allow access to vault', icon: Vault, onSelect: () => void reauthorizeVault() },
          { label: 'Disconnect vault', icon: Unplug, onSelect: () => void disconnectVault() },
        ]

  return (
    <div className="border-t border-(--divider-color) p-2">
      <button
        onClick={(e) => menu.open(e, [...vaultItems, 'separator', { label: 'Settings', onSelect: () => setSettingsOpen(true) }])}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-(--text-muted) transition-colors hover:bg-(--nav-item-background-hover) hover:text-(--text-normal)"
      >
        <Vault size={15} strokeWidth={1.75} className="shrink-0" />
        <span className="flex-1 truncate font-medium">{status === 'disconnected' ? 'Markab' : vaultName}</span>
        {status !== 'disconnected' && (
          <span
            title={status === 'connected' ? 'Vault connected' : 'Needs permission'}
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'connected' ? 'bg-(--color-green)' : 'bg-(--color-orange)'}`}
          />
        )}
        <ChevronsUpDown size={14} className="shrink-0 text-(--text-faint)" />
      </button>
      {menu.element}
    </div>
  )
}

export function Sidebar() {
  const open = useUi((s) => s.sidebarOpen)
  const width = useUi((s) => s.sidebarWidth)
  const tab = useUi((s) => s.sidebarTab)
  const showSidebarTab = useUi((s) => s.showSidebarTab)
  const setSidebarWidth = useUi((s) => s.setSidebarWidth)

  if (!open) return null

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent) => setSidebarWidth(startW + ev.clientX - startX)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <aside
      aria-label="Left sidebar"
      className="relative flex shrink-0 flex-col border-r border-(--divider-color) bg-(--background-secondary)"
      style={{ width }}
    >
      <div className="flex h-(--header-height) shrink-0 items-center gap-0.5 border-b border-(--divider-color) px-2">
        <ClickableIcon icon={Files} label="Files" size={16} active={tab === 'files'} onClick={() => showSidebarTab('files')} />
        <ClickableIcon icon={Search} label="Search" size={16} active={tab === 'search'} onClick={() => showSidebarTab('search')} />
      </div>
      {tab === 'files' ? <FileExplorer /> : <SearchPane />}
      <VaultSwitcher />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startResize}
        className="absolute -right-1 top-0 bottom-0 z-10 w-2 cursor-col-resize"
      />
    </aside>
  )
}
