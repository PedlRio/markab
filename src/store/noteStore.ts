import { create } from 'zustand'
import type { Folder, Note } from '../types'
import {
  disconnectVault as vaultDisconnect,
  folderPath,
  loadStoredHandle,
  noteFilename,
  pickVault,
  removeNote as vaultRemoveNote,
  syncAll,
  verifyPermission,
  writeNote,
} from '../lib/vault'

const storageGet = <T>(key: string): Promise<T | undefined> =>
  new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] as T | undefined))
  })

const storageSet = (key: string, value: unknown): void => {
  chrome.storage.local.set({ [key]: value })
}

interface NoteState {
  notes: Note[]
  folders: Folder[]
  activeNoteId: string | null
  isHydrated: boolean
  vaultHandle: FileSystemDirectoryHandle | null
  vaultName: string | null
  lastSyncedAt: number | null
  syncError: string | null
  isHidden: boolean
}

interface NoteActions {
  hydrate: () => Promise<void>
  createNote: (folderId?: string | null) => void
  deleteNote: (id: string) => void
  updateNote: (id: string, updates: Partial<Pick<Note, 'content' | 'title' | 'tags'>>) => void
  moveNote: (id: string, folderId: string | null) => void
  setActiveNote: (id: string | null) => void
  createFolder: (name: string, parentId?: string | null) => void
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  connectVault: () => Promise<void>
  disconnectVault: () => Promise<void>
  resyncVault: () => Promise<void>
  reveal: () => void
  hide: () => void
  toggleHidden: () => void
}

const persistMeta = (vaultName: string | null, lastSyncedAt: number | null) => {
  storageSet('vaultMeta', { vaultName, lastSyncedAt })
}

export const useNoteStore = create<NoteState & NoteActions>()((set, get) => {
  const currentLocation = (note: Note): { folderPath: string; filename: string } | undefined => {
    if (!note.syncedFilename) return undefined
    return { filename: note.syncedFilename, folderPath: note.syncedFolderPath ?? '' }
  }

  const syncNote = async (note: Note, previous?: { folderPath: string; filename: string }) => {
    const handle = get().vaultHandle
    if (!handle) return
    if (!(await verifyPermission(handle))) return
    try {
      const path = folderPath(note.folderId, get().folders)
      const loc = await writeNote(handle, note, path, previous)
      const ts = Date.now()
      set((s) => ({
        notes: s.notes.map((n) =>
          n.id === note.id
            ? { ...n, syncedFilename: loc.filename, syncedFolderPath: loc.folderPath }
            : n,
        ),
        lastSyncedAt: ts,
        syncError: null,
      }))
      persistMeta(get().vaultName, ts)
      storageSet('notes', get().notes)
    } catch (err) {
      set({ syncError: err instanceof Error ? err.message : String(err) })
    }
  }

  const deleteFromVault = async (loc: { folderPath: string; filename: string }) => {
    const handle = get().vaultHandle
    if (!handle) return
    if (!(await verifyPermission(handle))) return
    try {
      await vaultRemoveNote(handle, loc)
    } catch (err) {
      set({ syncError: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    notes: [],
    folders: [],
    activeNoteId: null,
    isHydrated: false,
    vaultHandle: null,
    vaultName: null,
    lastSyncedAt: null,
    syncError: null,
    isHidden: true,

    hydrate: async () => {
      const notes = (await storageGet<Note[]>('notes')) ?? []
      const folders = (await storageGet<Folder[]>('folders')) ?? []
      const meta = await storageGet<{ vaultName: string | null; lastSyncedAt: number | null }>(
        'vaultMeta',
      )
      const handle = await loadStoredHandle()
      const stillGranted = handle ? await verifyPermission(handle) : false
      const normalized = notes.map((n) => ({ ...n, folderId: n.folderId ?? null }))
      set({
        notes: normalized,
        folders,
        activeNoteId: normalized[0]?.id ?? null,
        isHydrated: true,
        vaultHandle: stillGranted ? handle : null,
        vaultName: stillGranted ? (handle?.name ?? meta?.vaultName ?? null) : null,
        lastSyncedAt: meta?.lastSyncedAt ?? null,
        isHidden: true,
      })
    },

    createNote: (folderId = null) => {
      const now = Date.now()
      const id = crypto.randomUUID()
      const newNote: Note = {
        id,
        title: 'Untitled',
        filename: `note-${id}.md`,
        content: '',
        createdAt: now,
        updatedAt: now,
        tags: [],
        folderId,
      }
      const notes = [newNote, ...get().notes]
      set({ notes, activeNoteId: id })
      storageSet('notes', notes)
      void syncNote(newNote)
    },

    deleteNote: (id: string) => {
      const target = get().notes.find((n) => n.id === id)
      const notes = get().notes.filter((n) => n.id !== id)
      const current = get().activeNoteId
      const activeNoteId = current === id ? (notes[0]?.id ?? null) : current
      set({ notes, activeNoteId })
      storageSet('notes', notes)
      const loc = target ? currentLocation(target) : undefined
      if (loc) void deleteFromVault(loc)
    },

    updateNote: (id, updates) => {
      const prev = get().notes.find((n) => n.id === id)
      const previousLoc = prev ? currentLocation(prev) : undefined
      const notes = get().notes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n,
      )
      set({ notes })
      storageSet('notes', notes)
      const updated = notes.find((n) => n.id === id)
      if (updated) void syncNote(updated, previousLoc)
    },

    moveNote: (id, folderId) => {
      const prev = get().notes.find((n) => n.id === id)
      if (!prev || prev.folderId === folderId) return
      const previousLoc = currentLocation(prev)
      const notes = get().notes.map((n) =>
        n.id === id ? { ...n, folderId, updatedAt: Date.now() } : n,
      )
      set({ notes })
      storageSet('notes', notes)
      const updated = notes.find((n) => n.id === id)
      if (updated) void syncNote(updated, previousLoc)
    },

    setActiveNote: (id) => set({ activeNoteId: id }),

    createFolder: (name, parentId = null) => {
      const folder: Folder = {
        id: crypto.randomUUID(),
        name: name.trim() || 'New Folder',
        parentId,
        createdAt: Date.now(),
      }
      const folders = [...get().folders, folder]
      set({ folders })
      storageSet('folders', folders)
    },

    renameFolder: (id, name) => {
      const folders = get().folders.map((f) =>
        f.id === id ? { ...f, name: name.trim() || f.name } : f,
      )
      set({ folders })
      storageSet('folders', folders)
      const affected = get().notes.filter((n) => {
        const path = folderPath(n.folderId, folders)
        return path && (n.syncedFolderPath ?? '') !== path
      })
      for (const note of affected) {
        void syncNote(note, currentLocation(note))
      }
    },

    deleteFolder: (id) => {
      const removeIds = new Set<string>()
      const collect = (fid: string) => {
        removeIds.add(fid)
        for (const child of get().folders.filter((f) => f.parentId === fid)) collect(child.id)
      }
      collect(id)
      const folders = get().folders.filter((f) => !removeIds.has(f.id))
      const notes = get().notes.map((n) =>
        n.folderId && removeIds.has(n.folderId) ? { ...n, folderId: null } : n,
      )
      set({ folders, notes })
      storageSet('folders', folders)
      storageSet('notes', notes)
      for (const note of notes) {
        if (note.syncedFolderPath && removeIds.size > 0) {
          void syncNote(note, currentLocation({ ...note, syncedFolderPath: note.syncedFolderPath }))
        }
      }
    },

    connectVault: async () => {
      try {
        const handle = await pickVault()
        const granted = await verifyPermission(handle, true)
        if (!granted) {
          set({ syncError: 'Permission denied' })
          return
        }
        set({ vaultHandle: handle, vaultName: handle.name, syncError: null })
        await syncAll(handle, get().notes, get().folders)
        const now = Date.now()
        const notes = get().notes.map((n) => ({
          ...n,
          syncedFilename: noteFilename(n),
          syncedFolderPath: folderPath(n.folderId, get().folders),
        }))
        set({ notes, lastSyncedAt: now })
        storageSet('notes', notes)
        persistMeta(handle.name, now)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        set({ syncError: err instanceof Error ? err.message : String(err) })
      }
    },

    disconnectVault: async () => {
      await vaultDisconnect()
      set({ vaultHandle: null, vaultName: null, lastSyncedAt: null, syncError: null })
      persistMeta(null, null)
    },

    resyncVault: async () => {
      const handle = get().vaultHandle
      if (!handle) return
      if (!(await verifyPermission(handle, true))) return
      await syncAll(handle, get().notes, get().folders)
      const now = Date.now()
      set({ lastSyncedAt: now })
      persistMeta(get().vaultName, now)
    },

    reveal: () => set({ isHidden: false }),
    hide: () => set({ isHidden: true }),
    toggleHidden: () => set((s) => ({ isHidden: !s.isHidden })),
  }
})
