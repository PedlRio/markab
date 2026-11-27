import { browser } from 'wxt/browser'
import type { Folder, Note, NoteSyncState, Prefs, VaultMeta } from './types'

/**
 * Persistence layout in `browser.storage.local`:
 *
 *   note:<id>   → Note        one key per note, so two open tabs never overwrite each other's notes
 *   folders     → Folder[]
 *   prefs       → Prefs
 *   vaultMeta   → VaultMeta
 *   schema      → number      layout version (see `migrate`)
 *   vault:<id>  → NoteSyncState   where that note lives in the Obsidian vault
 *   vaultFolders→ string[]    ids of folders known to exist in the vault
 *
 * Every write is picked up by the other open tabs through `subscribe`.
 */

export const SCHEMA_VERSION = 2
const NOTE_PREFIX = 'note:'
const noteKey = (id: string) => `${NOTE_PREFIX}${id}`
const SYNC_PREFIX = 'vault:'
const syncKey = (id: string) => `${SYNC_PREFIX}${id}`

export interface Snapshot {
  notes: Note[]
  folders: Folder[]
  prefs: Partial<Prefs> | undefined
  vaultMeta: VaultMeta | undefined
  syncStates: Record<string, NoteSyncState>
  vaultFolders: string[]
}

const local = () => browser.storage.local

/**
 * v1 (the original new-tab-mark build) kept every note in a single `notes` array
 * and typography in `editorPrefs`. Move both to the v2 layout. Driven by the presence
 * of the legacy keys (not the `schema` marker), so it is idempotent and safe to race.
 */
async function migrate(all: Record<string, unknown>): Promise<Record<string, unknown>> {
  const hasLegacy = 'notes' in all || 'editorPrefs' in all
  if (!hasLegacy && all.schema === SCHEMA_VERSION) return all
  const writes: Record<string, unknown> = { schema: SCHEMA_VERSION }
  const removals: string[] = []

  if (Array.isArray(all.notes)) {
    for (const raw of all.notes as Array<Note & { filename?: string }>) {
      const { filename: _legacy, ...note } = raw
      const existing = all[noteKey(note.id)] as Note | undefined
      if (existing && existing.updatedAt >= note.updatedAt) continue
      writes[noteKey(note.id)] = { ...note, folderId: note.folderId ?? null, tags: note.tags ?? [] }
    }
    removals.push('notes')
  }
  if (all.editorPrefs && typeof all.editorPrefs === 'object') {
    writes.prefs = { ...(all.editorPrefs as object), ...((all.prefs as object) ?? {}) }
    removals.push('editorPrefs')
  }

  await local().set(writes)
  if (removals.length) await local().remove(removals)
  const next = { ...all, ...writes }
  for (const key of removals) delete next[key]
  return next
}

export async function loadSnapshot(): Promise<Snapshot> {
  const all = await migrate(await local().get(null))
  const notes = Object.entries(all)
    .filter(([key]) => key.startsWith(NOTE_PREFIX))
    .map(([, value]) => value as Note)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    notes,
    folders: (all.folders as Folder[] | undefined) ?? [],
    prefs: all.prefs as Partial<Prefs> | undefined,
    vaultMeta: all.vaultMeta as VaultMeta | undefined,
    syncStates: Object.fromEntries(
      Object.entries(all)
        .filter(([key]) => key.startsWith(SYNC_PREFIX))
        .map(([key, value]) => [key.slice(SYNC_PREFIX.length), value as NoteSyncState]),
    ),
    vaultFolders: (all.vaultFolders as string[] | undefined) ?? [],
  }
}

export async function loadNote(id: string): Promise<Note | undefined> {
  return (await local().get(noteKey(id)))[noteKey(id)] as Note | undefined
}

export async function loadSyncState(id: string): Promise<NoteSyncState | undefined> {
  return (await local().get(syncKey(id)))[syncKey(id)] as NoteSyncState | undefined
}

export const saveSyncStates = (states: Record<string, NoteSyncState>) =>
  local().set(Object.fromEntries(Object.entries(states).map(([id, s]) => [syncKey(id), s])))
export const deleteSyncStates = (ids: string[]) => local().remove(ids.map(syncKey))
export const saveVaultFolders = (ids: string[]) => local().set({ vaultFolders: ids })
export async function loadVaultFolders(): Promise<string[]> {
  return ((await local().get('vaultFolders')).vaultFolders as string[] | undefined) ?? []
}

/** Forget every vault location (used when a different vault is connected). */
export async function clearSyncStates(): Promise<void> {
  const all = await local().get(null)
  await local().remove([...Object.keys(all).filter((k) => k.startsWith(SYNC_PREFIX)), 'vaultFolders'])
}

export const saveNote = (note: Note) => local().set({ [noteKey(note.id)]: note })
export const saveNotes = (notes: Note[]) =>
  local().set(Object.fromEntries(notes.map((n) => [noteKey(n.id), n])))
export const deleteNote = (id: string) => local().remove(noteKey(id))
export const saveFolders = (folders: Folder[]) => local().set({ folders })
export const savePrefs = (prefs: Prefs) => local().set({ prefs })
export const saveVaultMeta = (vaultMeta: VaultMeta) => local().set({ vaultMeta })

export interface StorageEvents {
  noteChanged: (note: Note) => void
  noteRemoved: (id: string) => void
  foldersChanged: (folders: Folder[]) => void
  prefsChanged: (prefs: Partial<Prefs>) => void
  vaultMetaChanged: (meta: VaultMeta) => void
}

/** Listen for writes made by any tab (including this one). Returns an unsubscribe function. */
export function subscribe(handlers: Partial<StorageEvents>): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local') return
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key.startsWith(NOTE_PREFIX)) {
        if (newValue == null) handlers.noteRemoved?.(key.slice(NOTE_PREFIX.length))
        else handlers.noteChanged?.(newValue as Note)
      } else if (key === 'folders' && newValue) {
        handlers.foldersChanged?.(newValue as Folder[])
      } else if (key === 'prefs' && newValue) {
        handlers.prefsChanged?.(newValue as Partial<Prefs>)
      } else if (key === 'vaultMeta' && newValue) {
        handlers.vaultMetaChanged?.(newValue as VaultMeta)
      }
    }
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}

// ─── Backup ─────────────────────────────────────────────────────────────────

export interface Backup {
  app: 'markab'
  version: number
  exportedAt: string
  notes: Note[]
  folders: Folder[]
}

export function buildBackup(notes: Note[], folders: Folder[]): Backup {
  return { app: 'markab', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), notes, folders }
}

/** Validates a parsed backup file. Accepts v1 exports that only carry `notes`. */
export function parseBackup(data: unknown): { notes: Note[]; folders: Folder[] } {
  if (!data || typeof data !== 'object') throw new Error('Not a Markab backup file')
  const { notes, folders } = data as Partial<Backup>
  if (!Array.isArray(notes)) throw new Error('Backup has no notes')
  const valid = notes.filter(
    (n): n is Note => typeof n?.id === 'string' && typeof n?.content === 'string',
  )
  return {
    notes: valid.map((n) => ({
      ...n,
      title: n.title ?? 'Untitled',
      tags: n.tags ?? [],
      folderId: n.folderId ?? null,
      createdAt: n.createdAt ?? Date.now(),
      updatedAt: n.updatedAt ?? Date.now(),
    })),
    folders: Array.isArray(folders) ? folders : [],
  }
}
