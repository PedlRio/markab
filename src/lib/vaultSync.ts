import { diff3Merge } from 'node-diff3'
import type { Folder, Note, NoteSyncState } from './types'
import {
  baseName,
  dirOf,
  folderPath,
  joinPath,
  legacyMarkabId,
  parseNoteFile,
  sanitizeName,
  serializeNote,
  stripLegacyFrontmatter,
  type VaultFs,
} from './vault'

/**
 * Two-way sync between Markab and an Obsidian vault.
 *
 * The vault is the source of truth for notes that live in it. `reconcile()` compares the
 * vault on disk with what Markab last wrote/read there (`NoteSyncState`) and works out:
 *   - files changed in Obsidian          → update the note
 *   - files created in Obsidian          → import as notes (folders too)
 *   - files renamed/moved in Obsidian    → follow them (matched by content)
 *   - files deleted in Obsidian          → delete the note (unless edited in Markab since)
 *   - notes edited on both sides         → merged line by line when the edits don't overlap;
 *                                          otherwise vault wins and Markab's version is kept as a copy
 *   - notes new or edited in Markab      → returned in `toWrite`, written by `writeNote()`
 *
 * Nothing here touches browser storage; the caller persists the result.
 */

export interface SyncInput {
  notes: Note[]
  folders: Folder[]
  states: Record<string, NoteSyncState>
  /** Folders known to exist in the vault (so a folder deleted in Obsidian can be told apart from a new one). */
  vaultFolders: string[]
}

export interface SyncResult {
  /** Notes to create or overwrite (imported, changed in the vault, conflict copies). */
  upserts: Note[]
  removedNoteIds: string[]
  /** The full folder list after sync. */
  folders: Folder[]
  vaultFolders: string[]
  /** Sync states to save; ids missing from here and present in `clearedStates` are dropped. */
  states: Record<string, NoteSyncState>
  clearedStates: string[]
  /** Note ids that must be written to the vault next. */
  toWrite: string[]
  stats: { imported: number; updated: number; moved: number; deleted: number; merged: number; conflicts: number }
  /** Every non-Markdown file in the vault (for resolving `![[embeds]]`). */
  attachments: string[]
}

/**
 * Three-way merge of a note edited in both places, by lines (like git). Returns null when
 * the same lines were changed differently on each side.
 */
export function merge3(base: string, local: string, remote: string): string | null {
  if (local === remote || base === remote) return local
  if (base === local) return remote
  const out: string[] = []
  for (const region of diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'))) {
    if (region.conflict) return null
    out.push(...region.ok)
  }
  return out.join('\n')
}

const isDirty = (note: Note, state: NoteSyncState | undefined) => !state || note.updatedAt !== state.version

const stamp = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
}

/** Where the note was before NoteSyncState existed (v1 wrote slug-named files). */
function legacyState(note: Note): NoteSyncState | undefined {
  if (!note.syncedFilename) return undefined
  return { path: joinPath(note.syncedFolderPath ?? '', note.syncedFilename), mtime: -1, version: -1 }
}

export async function reconcile(fs: VaultFs, input: SyncInput, now = Date.now()): Promise<SyncResult> {
  const { files, dirs, attachments } = await fs.list()
  const fileAt = new Map(files.map((f) => [f.path, f]))
  const dirSet = new Set(dirs)

  const notes = new Map(input.notes.map((n) => [n.id, { ...n }]))
  const states: Record<string, NoteSyncState> = {}
  for (const n of input.notes) {
    const s = input.states[n.id] ?? legacyState(n)
    if (s) states[n.id] = s
  }
  const upserts = new Map<string, Note>()
  const removed: string[] = []
  const cleared = new Set<string>()
  const toWrite = new Set<string>()
  const stats = { imported: 0, updated: 0, moved: 0, deleted: 0, merged: 0, conflicts: 0 }

  // ── Folders: make every vault directory a Markab folder ───────────────────
  let folders = input.folders.map((f) => ({ ...f }))
  const vaultFolders = new Set(input.vaultFolders)
  const pathToFolder = () => new Map(folders.map((f) => [folderPath(f.id, folders), f]))
  let byPath = pathToFolder()
  for (const dir of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length)) {
    let folder = byPath.get(dir)
    if (!folder) {
      folder = {
        id: crypto.randomUUID(),
        name: dir.split('/').pop()!,
        parentId: byPath.get(dirOf(dir))?.id ?? null,
        createdAt: now,
      }
      folders.push(folder)
      byPath = pathToFolder()
    }
    vaultFolders.add(folder.id)
  }
  const folderIdFor = (dir: string) => (dir ? (byPath.get(dir)?.id ?? null) : null)

  // ── Files Markab doesn't know yet, with their text read lazily ────────────
  const claimed = new Set(Object.values(states).map((s) => s.path))
  const unmapped = new Map(files.filter((f) => !claimed.has(f.path)).map((f) => [f.path, f]))
  const texts = new Map<string, string>()
  const textOf = async (path: string) => {
    if (!texts.has(path)) texts.set(path, (await fs.read(path)).text)
    return texts.get(path)!
  }

  const conflictCopy = (note: Note) => {
    const copy: Note = {
      ...note,
      id: crypto.randomUUID(),
      title: `${note.title.trim() || 'Untitled'} (conflict ${stamp(now)})`,
      createdAt: now,
      updatedAt: now,
    }
    delete copy.syncedFilename
    delete copy.syncedFolderPath
    upserts.set(copy.id, copy)
    toWrite.add(copy.id)
    stats.conflicts++
  }

  const takeVaultVersion = (note: Note, path: string, text: string, lastModified: number) => {
    const { frontmatter, body } = parseNoteFile(text)
    const updated: Note = { ...note, content: body, updatedAt: now }
    if (frontmatter) updated.frontmatter = frontmatter
    else delete updated.frontmatter
    delete updated.syncedFilename
    delete updated.syncedFolderPath
    notes.set(note.id, updated)
    upserts.set(note.id, updated)
    states[note.id] = { path, mtime: lastModified, version: now, base: text }
  }

  // ── Notes already in the vault ────────────────────────────────────────────
  for (const note of [...notes.values()]) {
    const state = states[note.id]
    if (!state) continue
    const file = fileAt.get(state.path)
    const dirty = state.version === -1 ? true : isDirty(note, state)

    if (file) {
      if (file.lastModified === state.mtime) {
        if (dirty) toWrite.add(note.id)
        continue
      }
      const text = await textOf(state.path)
      if (text === serializeNote(note)) {
        states[note.id] = { ...state, mtime: file.lastModified, version: note.updatedAt, base: text }
        continue
      }
      if (state.version === -1) {
        // A v1 file: Markab's copy is the original; rewrite it in the new format.
        states[note.id] = { ...state, mtime: file.lastModified }
        toWrite.add(note.id)
        continue
      }
      if (dirty) {
        const merged = state.base === undefined ? null : merge3(state.base, serializeNote(note), text)
        if (merged !== null) {
          // Both sides' edits fit together: keep the merge and write it back to the vault.
          takeVaultVersion(note, state.path, merged, file.lastModified)
          states[note.id] = { ...states[note.id]!, base: text }
          if (merged !== text) toWrite.add(note.id)
          stats.merged++
          continue
        }
        conflictCopy(note)
      }
      takeVaultVersion(note, state.path, text, file.lastModified)
      stats.updated++
      continue
    }

    // Gone from its path: renamed/moved in Obsidian (same text elsewhere) or deleted.
    let movedTo: string | null = null
    for (const candidate of unmapped.keys()) {
      if ((await textOf(candidate)) === serializeNote(note)) {
        movedTo = candidate
        break
      }
    }
    if (movedTo) {
      unmapped.delete(movedTo)
      const moved: Note = {
        ...note,
        title: baseName(movedTo),
        folderId: folderIdFor(dirOf(movedTo)),
        updatedAt: now,
      }
      notes.set(note.id, moved)
      upserts.set(note.id, moved)
      states[note.id] = { path: movedTo, mtime: fileAt.get(movedTo)!.lastModified, version: now, base: await textOf(movedTo) }
      stats.moved++
    } else if (dirty) {
      // Deleted in Obsidian but edited in Markab since: keep it, write it back.
      delete states[note.id]
      cleared.add(note.id)
      toWrite.add(note.id)
    } else {
      notes.delete(note.id)
      removed.push(note.id)
      delete states[note.id]
      cleared.add(note.id)
      stats.deleted++
    }
  }

  // ── Files new to Markab ───────────────────────────────────────────────────
  const unsyncedNotes = () => [...notes.values()].filter((n) => !states[n.id])
  for (const file of unmapped.values()) {
    const text = await textOf(file.path)
    const { frontmatter, body } = parseNoteFile(text)
    const title = baseName(file.path)
    const folderId = folderIdFor(dirOf(file.path))

    // Same note Markab already has: a v1 file (frontmatter id) or an identical unsynced note.
    const legacyId = legacyMarkabId(frontmatter)
    const twin =
      (legacyId ? notes.get(legacyId) : undefined) ??
      unsyncedNotes().find(
        (n) => (n.title.trim() || 'Untitled') === title && n.folderId === folderId && n.content === body,
      )
    if (twin) {
      states[twin.id] = { path: file.path, mtime: file.lastModified, version: -1 }
      if (legacyId && frontmatter) {
        const cleaned: Note = { ...twin }
        const kept = stripLegacyFrontmatter(frontmatter)
        if (kept) cleaned.frontmatter = kept
        else delete cleaned.frontmatter
        notes.set(twin.id, cleaned)
        upserts.set(twin.id, cleaned)
        toWrite.add(twin.id)
      } else {
        states[twin.id] = { path: file.path, mtime: file.lastModified, version: twin.updatedAt, base: text }
      }
      continue
    }

    const note: Note = {
      id: crypto.randomUUID(),
      title,
      content: body,
      createdAt: file.lastModified,
      updatedAt: now,
      tags: [],
      folderId,
      ...(frontmatter ? { frontmatter } : {}),
    }
    notes.set(note.id, note)
    upserts.set(note.id, note)
    states[note.id] = { path: file.path, mtime: file.lastModified, version: now, base: text }
    stats.imported++
  }

  // ── Markab-only notes go to the vault ─────────────────────────────────────
  for (const note of notes.values()) if (!states[note.id]) toWrite.add(note.id)

  // ── Folders deleted in Obsidian (known to the vault, now gone and empty) ──
  for (let changed = true; changed; ) {
    changed = false
    for (const f of folders) {
      if (!vaultFolders.has(f.id) || dirSet.has(folderPath(f.id, folders))) continue
      const hasNotes = [...notes.values()].some((n) => n.folderId === f.id)
      const hasChildren = folders.some((c) => c.parentId === f.id)
      if (!hasNotes && !hasChildren) {
        folders = folders.filter((x) => x.id !== f.id)
        vaultFolders.delete(f.id)
        changed = true
      }
    }
  }
  // Folders created in Markab: create them in the vault too.
  for (const f of folders) {
    const path = folderPath(f.id, folders)
    if (!dirSet.has(path)) await fs.mkdir(path)
    vaultFolders.add(f.id)
  }

  return {
    upserts: [...upserts.values()],
    removedNoteIds: removed,
    folders,
    vaultFolders: [...vaultFolders],
    states,
    clearedStates: [...cleared],
    toWrite: [...toWrite],
    stats,
    attachments,
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `Dir/Title.md`, or `Dir/Title 1.md`… when another file already has that name (Obsidian's rule). */
async function targetPath(
  fs: VaultFs,
  note: Note,
  folders: Folder[],
  current: string | undefined,
  taken: Set<string>,
): Promise<string> {
  const dir = folderPath(note.folderId, folders)
  const base = sanitizeName(note.title)
  // Keep the file's current name while the title still maps to it: a numbered name we
  // chose ("Title 1.md") or a name made in Obsidian with characters Markab wouldn't use.
  if (current && dirOf(current) === dir) {
    const name = baseName(current)
    if (sanitizeName(name) === base || new RegExp(`^${escapeRe(base)}( \\d+)?$`).test(name)) return current
  }
  for (let i = 0; ; i++) {
    const path = joinPath(dir, `${base}${i ? ` ${i}` : ''}.md`)
    if (path === current) return path
    if (taken.has(path)) continue
    if ((await fs.stat(path)) === null) return path
  }
}

export type WriteOutcome =
  | { kind: 'written'; state: NoteSyncState }
  /** The file changed in Obsidian since Markab last saw it: run `reconcile()` instead of overwriting. */
  | { kind: 'changed-in-vault' }

/**
 * Write one note to the vault at its Obsidian path, moving the file when the title or folder
 * changed. Never overwrites a file that was edited in Obsidian meanwhile.
 */
export async function writeNote(
  fs: VaultFs,
  note: Note,
  folders: Folder[],
  state: NoteSyncState | undefined,
  otherPaths: Set<string>,
): Promise<WriteOutcome> {
  if (state && state.mtime !== -1) {
    const mtime = await fs.stat(state.path)
    if (mtime !== null && mtime !== state.mtime) return { kind: 'changed-in-vault' }
  }
  const path = await targetPath(fs, note, folders, state?.path, otherPaths)
  const text = serializeNote(note)
  const mtime = await fs.write(path, text)
  // Empty folders are left alone, as in Obsidian.
  if (state && state.path !== path) await fs.remove(state.path)
  return { kind: 'written', state: { path, mtime, version: note.updatedAt, base: text } }
}
