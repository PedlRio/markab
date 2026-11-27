import { create } from 'zustand'
import * as storage from '@/lib/storage'
import type { Folder, Note } from '@/lib/types'
import * as vault from '@/lib/vault'
import { reconcile, writeNote } from '@/lib/vaultSync'

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
  /** Shown after a sync that brought changes in, e.g. "From Obsidian: 2 notes updated." */
  syncReport: string | null
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
  /** Read changes from the vault and write pending ones to it. */
  resyncVault: () => Promise<void>
  /**
   * Save a pasted/dropped file into the vault, where Obsidian would put it, and return the
   * name to embed (`![[name]]`). Null when no vault is connected.
   */
  saveAttachment: (file: File, noteId: string) => Promise<string | null>
  /** A displayable URL for an embed name like `cat.png`, or null when the vault doesn't have it. */
  resolveAttachment: (name: string) => Promise<string | null>
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * All vault I/O, from every open tab, runs one task at a time under a Web Lock. Without it,
 * two tabs scanning at once would import the same new file twice.
 */
const withVaultLock = <T>(task: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('markab-vault', task) : task()

export const useNotes = create<NotesStore>()((set, get) => {
  /** The vault handle can't live in state (not serializable, not reactive-friendly). */
  let root: FileSystemDirectoryHandle | null = null
  let fs: vault.VaultFs | null = null
  let lastScan = 0
  /** Vault paths of every non-Markdown file, refreshed on each scan. */
  let attachments: string[] = []
  let lastRelist = 0
  const blobUrls = new Map<string, Promise<string | null>>()

  const run = (task: (fs: vault.VaultFs) => Promise<void>) => {
    if (get().vaultStatus !== 'connected' || !fs) return Promise.resolve()
    const vfs = fs
    return withVaultLock(() => task(vfs)).catch((err: unknown) => set({ syncError: errorMessage(err) }))
  }

  const markSynced = () => {
    const lastSyncedAt = Date.now()
    set({ lastSyncedAt, syncError: null })
    void storage.saveVaultMeta({ vaultName: get().vaultName, lastSyncedAt })
  }

  /** Write one note at its Obsidian path. Must run inside `run()`. */
  const writeOne = async (vfs: vault.VaultFs, id: string): Promise<void> => {
    const note = await storage.loadNote(id)
    if (!note) return
    const snapshot = await storage.loadSnapshot()
    const otherPaths = new Set(
      Object.entries(snapshot.syncStates)
        .filter(([other]) => other !== id)
        .map(([, s]) => s.path),
    )
    const outcome = await writeNote(vfs, note, snapshot.folders, snapshot.syncStates[id], otherPaths)
    if (outcome.kind === 'changed-in-vault') {
      // Edited in Obsidian meanwhile: reconcile instead, which keeps both versions.
      await reconcileNow(vfs)
      return
    }
    await storage.saveSyncStates({ [id]: outcome.state })
    markSynced()
  }

  /** Bring the vault and Markab in line. Must run inside `run()`. */
  const reconcileNow = async (vfs: vault.VaultFs): Promise<void> => {
    lastScan = Date.now()
    const snapshot = await storage.loadSnapshot()
    const result = await reconcile(vfs, {
      notes: snapshot.notes,
      folders: snapshot.folders,
      states: snapshot.syncStates,
      vaultFolders: snapshot.vaultFolders,
    })

    // A note edited in Markab while we were scanning keeps that edit: skip it now; the next
    // scan sees it changed on both sides and keeps both versions.
    const before = new Map(snapshot.notes.map((n) => [n.id, n.updatedAt]))
    const unchanged = async (id: string) =>
      !before.has(id) || (await storage.loadNote(id))?.updatedAt === before.get(id)
    const upserts: Note[] = []
    const skipped = new Set<string>()
    for (const n of result.upserts) {
      if (await unchanged(n.id)) upserts.push(n)
      else skipped.add(n.id)
    }
    const removed: string[] = []
    for (const id of result.removedNoteIds) if (await unchanged(id)) removed.push(id)
    const states = Object.fromEntries(Object.entries(result.states).filter(([id]) => !skipped.has(id)))

    attachments = result.attachments
    if (upserts.length) await storage.saveNotes(upserts)
    for (const id of removed) await storage.deleteNote(id)
    await storage.saveFolders(result.folders)
    await storage.saveVaultFolders(result.vaultFolders)
    await storage.saveSyncStates(states)
    if (result.clearedStates.length) await storage.deleteSyncStates(result.clearedStates)

    set((s) => {
      const notes = new Map(s.notes.map((n) => [n.id, n]))
      for (const n of upserts) notes.set(n.id, n)
      for (const id of removed) notes.delete(id)
      const list = [...notes.values()].sort(byCreated)
      return {
        notes: list,
        folders: result.folders,
        activeNoteId: s.activeNoteId && notes.has(s.activeNoteId) ? s.activeNoteId : (list[0]?.id ?? null),
      }
    })

    for (const id of result.toWrite) await writeOne(vfs, id)

    const { imported, updated, moved, deleted, merged, conflicts } = result.stats
    const parts = [
      imported && `${plural(imported, 'note')} imported`,
      updated && `${plural(updated, 'note')} updated`,
      moved && `${plural(moved, 'note')} moved`,
      deleted && `${plural(deleted, 'note')} deleted`,
      merged && `${plural(merged, 'note')} merged with your edits`,
      conflicts && `${plural(conflicts, 'conflict')} kept as a copy`,
    ].filter(Boolean)
    if (parts.length) set({ syncReport: `From Obsidian: ${parts.join(', ')}.` })
    markSynced()
  }

  const syncNote = (id: string) => void run((vfs) => writeOne(vfs, id))
  const scan = () => run(reconcileNow)

  /** After a folder is renamed or deleted in Markab: move its notes, then drop the old directory. */
  const syncFolderChange = (oldPath: string, affected: string[], noteIds: string[]) =>
    void run(async (vfs) => {
      const known = new Set(await storage.loadVaultFolders())
      for (const id of affected) known.delete(id) // their old directory is no longer theirs
      await storage.saveVaultFolders([...known])
      for (const id of noteIds) await writeOne(vfs, id)
      await vfs.removeEmptyTree(oldPath)
      await reconcileNow(vfs) // creates the new directories
    })

  const descendants = (id: string) => {
    const ids = [id]
    for (let i = 0; i < ids.length; i++) {
      for (const f of get().folders) if (f.parentId === ids[i]) ids.push(f.id)
    }
    return ids
  }

  const setVaultConnected = (h: FileSystemDirectoryHandle) => {
    root = h
    fs = vault.createVaultFs(h)
    set({ vaultStatus: 'connected', vaultName: h.name, syncError: null })
  }

  /** Re-read the vault whenever the user comes back to this tab (e.g. after editing in Obsidian). */
  const scanOnReturn = () => {
    const maybeScan = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastScan < 1500) return
      void scan()
    }
    window.addEventListener('focus', maybeScan)
    document.addEventListener('visibilitychange', maybeScan)
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
    syncReport: null,

    hydrate: async ({ hideOnOpen }) => {
      const snapshot = await storage.loadSnapshot()
      const notes = snapshot.notes.sort(byCreated)
      const remembered = recallActive()
      const activeNoteId = notes.some((n) => n.id === remembered) ? remembered : (notes[0]?.id ?? null)

      let vaultStatus: VaultStatus = 'disconnected'
      const stored = await vault.loadStoredHandle().catch(() => null)
      if (stored) {
        root = stored
        fs = vault.createVaultFs(stored)
        vaultStatus = (await vault.verifyPermission(stored).catch(() => false)) ? 'connected' : 'needs-permission'
      }

      set({
        notes,
        folders: snapshot.folders,
        activeNoteId,
        isHydrated: true,
        isHidden: hideOnOpen,
        vaultStatus,
        vaultName: stored ? stored.name : null,
        lastSyncedAt: snapshot.vaultMeta?.lastSyncedAt ?? null,
      })
      listenToOtherTabs()
      scanOnReturn()
      if (vaultStatus === 'connected') void scan()
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
      // Written to the vault on its first edit, so an abandoned empty note leaves no file.
      void storage.saveNote(note)
    },

    deleteNote: (id) => {
      const target = get().notes.find((n) => n.id === id)
      if (!target) return
      const notes = get().notes.filter((n) => n.id !== id)
      const activeNoteId = get().activeNoteId === id ? (notes[0]?.id ?? null) : get().activeNoteId
      set({ notes, activeNoteId })
      void storage.deleteNote(id)
      void run(async (vfs) => {
        const state = await storage.loadSyncState(id)
        if (state) await vfs.remove(state.path)
        await storage.deleteSyncStates([id])
      })
    },

    updateNote: (id, updates) => {
      const current = get().notes.find((n) => n.id === id)
      if (!current) return
      const changed = (Object.keys(updates) as Array<keyof typeof updates>).some((k) => updates[k] !== current[k])
      if (!changed) return
      const note = { ...current, ...updates, updatedAt: Date.now() }
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }))
      void storage.saveNote(note).then(() => syncNote(id))
    },

    moveNote: (id, folderId) => {
      const current = get().notes.find((n) => n.id === id)
      if (!current || current.folderId === folderId) return
      const note = { ...current, folderId, updatedAt: Date.now() }
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }))
      void storage.saveNote(note).then(() => syncNote(id))
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
      void storage.saveNote(note).then(() => syncNote(note.id))
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
      void storage.saveFolders(folders).then(() => scan())
      return folder.id
    },

    renameFolder: (id, name) => {
      const trimmed = name.trim()
      const old = get().folders.find((f) => f.id === id)
      if (!trimmed || !old || old.name === trimmed) return
      const oldPath = vault.folderPath(id, get().folders)
      const affected = descendants(id)
      const folders = get().folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
      set({ folders })
      const noteIds = get().notes.filter((n) => n.folderId && affected.includes(n.folderId)).map((n) => n.id)
      void storage.saveFolders(folders).then(() => syncFolderChange(oldPath, affected, noteIds))
    },

    deleteFolder: (id) => {
      const oldPath = vault.folderPath(id, get().folders)
      const removed = new Set(descendants(id))
      const folders = get().folders.filter((f) => !removed.has(f.id))
      const moved: Note[] = []
      const notes = get().notes.map((n) => {
        if (!n.folderId || !removed.has(n.folderId)) return n
        const note = { ...n, folderId: null, updatedAt: Date.now() }
        moved.push(note)
        return note
      })
      set({ folders, notes })
      void Promise.all([storage.saveFolders(folders), moved.length ? storage.saveNotes(moved) : null]).then(() =>
        syncFolderChange(oldPath, [...removed], moved.map((n) => n.id)),
      )
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
      void Promise.all([
        storage.saveNotes(incoming.map((n) => notesById.get(n.id)!)),
        storage.saveFolders(folders),
      ]).then(() => scan())
    },

    connectVault: async () => {
      try {
        const picked = await vault.pickVault()
        if (!(await vault.verifyPermission(picked, true))) {
          set({ syncError: 'Permission to the vault folder was denied' })
          return
        }
        // A different vault than last time: forget where notes lived in the old one.
        const previous = (await storage.loadSnapshot()).vaultMeta?.vaultName
        if (previous && previous !== picked.name) await storage.clearSyncStates()
        setVaultConnected(picked)
        await storage.saveVaultMeta({ vaultName: picked.name, lastSyncedAt: get().lastSyncedAt })
        await scan()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        set({ syncError: errorMessage(err) })
      }
    },

    reauthorizeVault: async () => {
      if (!root) return
      try {
        if (await vault.verifyPermission(root, true)) {
          setVaultConnected(root)
          await scan()
        } else {
          set({ syncError: 'Permission to the vault folder was denied' })
        }
      } catch (err) {
        set({ syncError: errorMessage(err) })
      }
    },

    disconnectVault: async () => {
      root = null
      fs = null
      await vault.disconnectVault()
      // vaultMeta keeps the vault's name and every note keeps its vault location, so
      // reconnecting the same vault picks up where it left off instead of duplicating.
      set({ vaultStatus: 'disconnected', vaultName: null, syncError: null, syncReport: null })
    },

    resyncVault: async () => {
      if (!root) return
      if (get().vaultStatus !== 'connected') return get().reauthorizeVault()
      await scan()
    },

    saveAttachment: async (file, noteId) => {
      if (get().vaultStatus !== 'connected' || !fs) return null
      const vfs = fs
      return withVaultLock(async () => {
        const note = get().notes.find((n) => n.id === noteId)
        const noteDir = note ? vault.folderPath(note.folderId, get().folders) : ''
        const dir = vault.attachmentDir((await vfs.readConfig()).attachmentFolderPath, noteDir)
        const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
        const base = vault.pastedImageName(new Date(), ext).replace(/\.[^.]+$/, '')
        // Embeds are matched by file name, so keep the name unique across the whole vault.
        const taken = new Set(attachments.map((p) => p.split('/').pop()!.toLowerCase()))
        let name = `${base}.${ext}`
        for (let i = 1; taken.has(name.toLowerCase()) || (await vfs.stat(vault.joinPath(dir, name))) !== null; i++) {
          name = `${base} ${i}.${ext}`
        }
        const path = vault.joinPath(dir, name)
        await vfs.writeBlob(path, file)
        attachments = [...attachments, path]
        blobUrls.set(path, Promise.resolve(URL.createObjectURL(file)))
        return name
      }).catch((err: unknown) => {
        set({ syncError: errorMessage(err) })
        return null
      })
    },

    resolveAttachment: async (name) => {
      if (!fs) return null
      const vfs = fs
      let path = vault.resolveAttachment(name, attachments)
      if (!path && Date.now() - lastRelist > 3000) {
        // Maybe added in Obsidian since the last scan (re-list at most every few seconds).
        lastRelist = Date.now()
        attachments = (await vfs.list().catch(() => ({ attachments }))).attachments
        path = vault.resolveAttachment(name, attachments)
      }
      if (!path) return null
      if (!blobUrls.has(path)) {
        blobUrls.set(
          path,
          vfs.readBlob(path).then(
            (blob) => URL.createObjectURL(blob),
            () => null,
          ),
        )
      }
      return blobUrls.get(path)!
    },

    setHidden: (isHidden) => set({ isHidden }),
    toggleHidden: () => set((s) => ({ isHidden: !s.isHidden })),
  }
})
