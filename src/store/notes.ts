import { create } from 'zustand'
import * as storage from '@/lib/storage'
import type { Folder, Note } from '@/lib/types'
import * as vault from '@/lib/vault'

export type VaultStatus = 'disconnected' | 'connected' | 'needs-permission'

interface NotesState {
  notes: Note[]
  folders: Folder[]
  activeNoteId: string | null
  isHydrated: boolean
  isHidden: boolean
  vaultStatus: VaultStatus
  vaultName: string | null
  lastSyncedAt: number | null
  syncError: string | null
}

interface NotesActions {
  hydrate: (opts: { hideOnOpen: boolean }) => Promise<void>
  createNote: (folderId?: string | null) => void
  deleteNote: (id: string) => void
  updateNote: (id: string, updates: Partial<Pick<Note, 'content' | 'title' | 'tags'>>) => void
  moveNote: (id: string, folderId: string | null) => void
  setActiveNote: (id: string | null) => void
  /** Follow a `[[wikilink]]`: open the note with that title, creating it if missing (as Obsidian does). */
  openNoteByTitle: (title: string) => void
  createFolder: (name: string, parentId?: string | null) => string
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  importNotes: (notes: Note[], folders: Folder[]) => void
  connectVault: () => Promise<void>
  reauthorizeVault: () => Promise<void>
  disconnectVault: () => Promise<void>
  resyncVault: () => Promise<void>
  setHidden: (hidden: boolean) => void
  toggleHidden: () => void
}

export type NotesStore = NotesState & NotesActions

const LAST_NOTE_KEY = 'markab:lastNote'
const rememberActive = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_NOTE_KEY, id)
  } catch {
    // storage unavailable — not important
  }
}
const recallActive = () => {
  try {
    return localStorage.getItem(LAST_NOTE_KEY)
  } catch {
    return null
  }
}

/** Newest first by creation, so notes don't jump around the sidebar while you type. */
const byCreated = (a: Note, b: Note) => b.createdAt - a.createdAt
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const useNotes = create<NotesStore>()((set, get) => {
  /** The vault handle can't live in state (not serializable, not reactive-friendly). */
  let handle: FileSystemDirectoryHandle | null = null
  /** Vault writes run one at a time so a rename and an edit can't race on the same file. */
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((err: unknown) => set({ syncError: errorMessage(err) }))
    return queue
  }

  const persistNote = (note: Note) => void storage.saveNote(note)

  const markSynced = () => {
    const lastSyncedAt = Date.now()
    set({ lastSyncedAt, syncError: null })
    void storage.saveVaultMeta({ vaultName: get().vaultName, lastSyncedAt })
  }

  /** Write one note to the vault (no-op unless connected). Fire-and-forget. */
  const syncNote = (id: string) => {
    if (get().vaultStatus !== 'connected' || !handle) return
    const h = handle
    void enqueue(async () => {
      const note = get().notes.find((n) => n.id === id)
      if (!note) return
      const path = vault.folderPath(note.folderId, get().folders)
      const loc = await vault.writeNote(h, note, path, vault.syncedLocation(note))
      if (loc.filename !== note.syncedFilename || loc.folderPath !== (note.syncedFolderPath ?? '')) {
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, syncedFilename: loc.filename, syncedFolderPath: loc.folderPath } : n,
          ),
        }))
        const latest = get().notes.find((n) => n.id === id)
        if (latest) persistNote(latest)
      }
      markSynced()
    })
  }

  const syncEverything = () => {
    for (const note of get().notes) syncNote(note.id)
  }

  /** After folder changes, rewrite only notes whose vault path moved. */
  const syncMovedNotes = () => {
    const { notes, folders } = get()
    for (const note of notes) {
      if (note.syncedFilename && vault.folderPath(note.folderId, folders) !== (note.syncedFolderPath ?? '')) {
        syncNote(note.id)
      }
    }
  }

  const setVaultConnected = (h: FileSystemDirectoryHandle) => {
    handle = h
    set({ vaultStatus: 'connected', vaultName: h.name, syncError: null })
  }

  const listenToOtherTabs = () => {
    storage.subscribe({
      noteChanged: (note) =>
        set((s) => {
          const existing = s.notes.find((n) => n.id === note.id)
          // Storage events arrive in write order; an older echo of our own write must not
          // roll back a newer local edit.
          if (existing && existing.updatedAt > note.updatedAt) return s
          const notes = existing
            ? s.notes.map((n) => (n.id === note.id ? note : n))
            : [note, ...s.notes].sort(byCreated)
          return { notes }
        }),
      noteRemoved: (id) =>
        set((s) => {
          const notes = s.notes.filter((n) => n.id !== id)
          const activeNoteId = s.activeNoteId === id ? (notes[0]?.id ?? null) : s.activeNoteId
          return { notes, activeNoteId }
        }),
      foldersChanged: (folders) => set({ folders }),
      vaultMetaChanged: (meta) => set({ lastSyncedAt: meta.lastSyncedAt }),
    })
  }

  return {
    notes: [],
    folders: [],
    activeNoteId: null,
    isHydrated: false,
    isHidden: true,
    vaultStatus: 'disconnected',
    vaultName: null,
    lastSyncedAt: null,
    syncError: null,

    hydrate: async ({ hideOnOpen }) => {
      const snapshot = await storage.loadSnapshot()
      const notes = snapshot.notes.sort(byCreated)
      const remembered = recallActive()
      const activeNoteId = notes.some((n) => n.id === remembered) ? remembered : (notes[0]?.id ?? null)

      let vaultStatus: VaultStatus = 'disconnected'
      const stored = await vault.loadStoredHandle().catch(() => null)
      if (stored) {
        handle = stored
        vaultStatus = (await vault.verifyPermission(stored)) ? 'connected' : 'needs-permission'
      }

      set({
        notes,
        folders: snapshot.folders,
        activeNoteId,
        isHydrated: true,
        isHidden: hideOnOpen,
        vaultStatus,
        vaultName: stored?.name ?? snapshot.vaultMeta?.vaultName ?? null,
        lastSyncedAt: snapshot.vaultMeta?.lastSyncedAt ?? null,
      })
      listenToOtherTabs()
    },

    createNote: (folderId = null) => {
      const now = Date.now()
      const note: Note = {
        id: crypto.randomUUID(),
        title: '',
        content: '',
        createdAt: now,
        updatedAt: now,
        tags: [],
        folderId,
      }
      set((s) => ({ notes: [note, ...s.notes], activeNoteId: note.id, isHidden: false }))
      rememberActive(note.id)
      persistNote(note)
    },

    deleteNote: (id) => {
      const target = get().notes.find((n) => n.id === id)
      if (!target) return
      const notes = get().notes.filter((n) => n.id !== id)
      const activeNoteId = get().activeNoteId === id ? (notes[0]?.id ?? null) : get().activeNoteId
      set({ notes, activeNoteId })
      void storage.deleteNote(id)
      const loc = vault.syncedLocation(target)
      if (loc && handle && get().vaultStatus === 'connected') {
        const h = handle
        void enqueue(() => vault.removeNote(h, loc))
      }
    },

    updateNote: (id, updates) => {
      const current = get().notes.find((n) => n.id === id)
      if (!current) return
      const changed = (Object.keys(updates) as Array<keyof typeof updates>).some(
        (k) => updates[k] !== current[k],
      )
      if (!changed) return
      const note = { ...current, ...updates, updatedAt: Date.now() }
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }))
      persistNote(note)
      syncNote(id)
    },

    moveNote: (id, folderId) => {
      const current = get().notes.find((n) => n.id === id)
      if (!current || current.folderId === folderId) return
      const note = { ...current, folderId, updatedAt: Date.now() }
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }))
      persistNote(note)
      syncNote(id)
    },

    setActiveNote: (id) => {
      set({ activeNoteId: id })
      rememberActive(id)
    },

    openNoteByTitle: (title) => {
      const wanted = title.trim().toLowerCase()
      const found = get().notes.find((n) => (n.title.trim() || 'Untitled').toLowerCase() === wanted)
      if (found) return get().setActiveNote(found.id)
      const now = Date.now()
      const note: Note = {
        id: crypto.randomUUID(),
        title: title.trim(),
        content: '',
        createdAt: now,
        updatedAt: now,
        tags: [],
        folderId: get().notes.find((n) => n.id === get().activeNoteId)?.folderId ?? null,
      }
      set((s) => ({ notes: [note, ...s.notes], activeNoteId: note.id }))
      rememberActive(note.id)
      persistNote(note)
      syncNote(note.id)
    },

    createFolder: (name, parentId = null) => {
      const folder: Folder = {
        id: crypto.randomUUID(),
        name: name.trim() || 'New folder',
        parentId,
        createdAt: Date.now(),
      }
      const folders = [...get().folders, folder]
      set({ folders })
      void storage.saveFolders(folders)
      return folder.id
    },

    renameFolder: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const folders = get().folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
      set({ folders })
      void storage.saveFolders(folders)
      syncMovedNotes()
    },

    deleteFolder: (id) => {
      const removed = new Set<string>()
      const collect = (fid: string) => {
        removed.add(fid)
        for (const child of get().folders.filter((f) => f.parentId === fid)) collect(child.id)
      }
      collect(id)
      const folders = get().folders.filter((f) => !removed.has(f.id))
      const moved: Note[] = []
      const notes = get().notes.map((n) => {
        if (!n.folderId || !removed.has(n.folderId)) return n
        const note = { ...n, folderId: null }
        moved.push(note)
        return note
      })
      set({ folders, notes })
      void storage.saveFolders(folders)
      if (moved.length) void storage.saveNotes(moved)
      syncMovedNotes()
    },

    importNotes: (incoming, incomingFolders) => {
      const notesById = new Map(get().notes.map((n) => [n.id, n]))
      for (const note of incoming) {
        const existing = notesById.get(note.id)
        if (!existing || existing.updatedAt < note.updatedAt) notesById.set(note.id, note)
      }
      const foldersById = new Map(get().folders.map((f) => [f.id, f]))
      for (const folder of incomingFolders) if (!foldersById.has(folder.id)) foldersById.set(folder.id, folder)
      const notes = [...notesById.values()].sort(byCreated)
      const folders = [...foldersById.values()]
      set({ notes, folders, activeNoteId: get().activeNoteId ?? notes[0]?.id ?? null })
      void storage.saveNotes(incoming.map((n) => notesById.get(n.id)!))
      void storage.saveFolders(folders)
      syncEverything()
    },

    connectVault: async () => {
      try {
        const picked = await vault.pickVault()
        if (!(await vault.verifyPermission(picked, true))) {
          set({ syncError: 'Permission to the vault folder was denied' })
          return
        }
        setVaultConnected(picked)
        void storage.saveVaultMeta({ vaultName: picked.name, lastSyncedAt: get().lastSyncedAt })
        syncEverything()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        set({ syncError: errorMessage(err) })
      }
    },

    reauthorizeVault: async () => {
      if (!handle) return
      try {
        if (await vault.verifyPermission(handle, true)) {
          setVaultConnected(handle)
          syncEverything()
        } else {
          set({ syncError: 'Permission to the vault folder was denied' })
        }
      } catch (err) {
        set({ syncError: errorMessage(err) })
      }
    },

    disconnectVault: async () => {
      handle = null
      await vault.disconnectVault()
      set({ vaultStatus: 'disconnected', vaultName: null, lastSyncedAt: null, syncError: null })
      void storage.saveVaultMeta({ vaultName: null, lastSyncedAt: null })
    },

    resyncVault: async () => {
      if (!handle) return
      if (get().vaultStatus !== 'connected') return get().reauthorizeVault()
      syncEverything()
      await queue
    },

    setHidden: (isHidden) => set({ isHidden }),
    toggleHidden: () => set((s) => ({ isHidden: !s.isHidden })),
  }
})
