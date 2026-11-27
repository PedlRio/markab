import { beforeEach, describe, expect, it } from 'vitest'
import type { Folder, Note, NoteSyncState } from '@/lib/types'
import { dirOf, type VaultFs } from '@/lib/vault'
import { merge3, reconcile, type SyncInput, type SyncResult, writeNote } from '@/lib/vaultSync'

/** An in-memory vault. `obsidian*` helpers play the user editing files in Obsidian. */
class MemoryVault implements VaultFs {
  files = new Map<string, { text: string; mtime: number }>()
  dirs = new Set<string>()
  private clock = 1000

  tick() {
    return ++this.clock
  }
  private addDirs(path: string) {
    for (let d = dirOf(path); d; d = dirOf(d)) this.dirs.add(d)
  }
  obsidianWrite(path: string, text: string) {
    this.addDirs(path)
    this.files.set(path, { text, mtime: this.tick() })
  }
  obsidianRename(from: string, to: string) {
    const f = this.files.get(from)!
    this.files.delete(from)
    this.addDirs(to)
    this.files.set(to, f)
  }
  text(path: string) {
    return this.files.get(path)?.text
  }

  async list() {
    return {
      files: [...this.files].filter(([p]) => p.endsWith('.md')).map(([path, f]) => ({ path, lastModified: f.mtime })),
      dirs: [...this.dirs],
      attachments: [...this.files.keys()].filter((p) => !p.endsWith('.md')),
    }
  }
  async read(path: string) {
    const f = this.files.get(path)
    if (!f) throw new Error(`missing ${path}`)
    return { text: f.text, lastModified: f.mtime }
  }
  async stat(path: string) {
    return this.files.get(path)?.mtime ?? null
  }
  async write(path: string, text: string) {
    this.addDirs(path)
    const mtime = this.tick()
    this.files.set(path, { text, mtime })
    return mtime
  }
  async remove(path: string) {
    this.files.delete(path)
  }
  async mkdir(path: string) {
    this.dirs.add(path)
    this.addDirs(`${path}/x`)
  }
  async readBlob(path: string) {
    return new Blob([this.files.get(path)!.text])
  }
  async writeBlob(path: string, data: Blob) {
    this.obsidianWrite(path, await data.text())
  }
  async readConfig() {
    return {}
  }
  async removeEmptyTree(path: string) {
    if (![...this.files.keys()].some((f) => f.startsWith(`${path}/`))) {
      for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d)
    }
  }
}

/** Markab's side: notes, folders and sync states, updated the way the store does it. */
class Markab {
  notes = new Map<string, Note>()
  folders: Folder[] = []
  states: Record<string, NoteSyncState> = {}
  vaultFolders: string[] = []
  private now = 10_000

  constructor(readonly vault: MemoryVault) {}

  input(): SyncInput {
    return { notes: [...this.notes.values()], folders: this.folders, states: this.states, vaultFolders: this.vaultFolders }
  }
  add(title: string, content: string, folderId: string | null = null): Note {
    const note: Note = { id: crypto.randomUUID(), title, content, createdAt: this.now, updatedAt: ++this.now, tags: [], folderId }
    this.notes.set(note.id, note)
    return note
  }
  edit(id: string, patch: Partial<Note>) {
    this.notes.set(id, { ...this.notes.get(id)!, ...patch, updatedAt: ++this.now })
  }
  byTitle(title: string) {
    return [...this.notes.values()].find((n) => n.title === title)
  }
  async write(id: string) {
    const others = new Set(Object.entries(this.states).filter(([o]) => o !== id).map(([, s]) => s.path))
    const out = await writeNote(this.vault, this.notes.get(id)!, this.folders, this.states[id], others)
    if (out.kind === 'written') this.states[id] = out.state
    return out
  }
  /** One full sync: reconcile, apply, then write what's pending. */
  async sync(): Promise<SyncResult> {
    const result = await reconcile(this.vault, this.input(), ++this.now)
    for (const n of result.upserts) this.notes.set(n.id, n)
    for (const id of result.removedNoteIds) this.notes.delete(id)
    this.folders = result.folders
    this.vaultFolders = result.vaultFolders
    this.states = { ...result.states }
    for (const id of result.clearedStates) if (!result.states[id]) delete this.states[id]
    for (const id of result.toWrite) await this.write(id)
    return result
  }
}

let vault: MemoryVault
let app: Markab

beforeEach(() => {
  vault = new MemoryVault()
  app = new Markab(vault)
})

describe('merge3', () => {
  it('takes whichever side changed when only one did', () => {
    expect(merge3('a', 'a', 'b')).toBe('b')
    expect(merge3('a', 'b', 'a')).toBe('b')
    expect(merge3('a', 'b', 'b')).toBe('b')
  })
  it('combines changes to different lines', () => {
    expect(merge3('1\n2\n3\n4\n5', 'one\n2\n3\n4\n5', '1\n2\n3\n4\nfive')).toBe('one\n2\n3\n4\nfive')
  })
  it('refuses when both sides changed the same line', () => {
    expect(merge3('1\n2\n3', '1\nB\n3', '1\nC\n3')).toBeNull()
  })
})

describe('stage 1 — Obsidian file names', () => {
  it('writes notes as "Title.md" in folder directories, with no Markab frontmatter', async () => {
    app.folders = [{ id: 'f', name: 'Projects', parentId: null, createdAt: 0 }]
    app.add('Weekly plan', '# Plan', 'f')
    await app.sync()
    expect(vault.text('Projects/Weekly plan.md')).toBe('# Plan')
  })

  it('numbers duplicate titles like Obsidian and keeps the number on later edits', async () => {
    const a = app.add('Idea', 'one')
    const b = app.add('Idea', 'two')
    await app.sync()
    expect(new Set([vault.text('Idea.md'), vault.text('Idea 1.md')])).toEqual(new Set(['one', 'two']))
    const second = app.states[b.id]!.path === 'Idea 1.md' ? b : a
    app.edit(second.id, { content: 'edited' })
    await app.write(second.id)
    expect(vault.text('Idea 1.md')).toBe('edited')
  })

  it('renaming the title renames the file', async () => {
    const n = app.add('Draft', 'x')
    await app.sync()
    app.edit(n.id, { title: 'Final' })
    await app.write(n.id)
    expect(vault.text('Final.md')).toBe('x')
    expect(vault.text('Draft.md')).toBeUndefined()
  })

  it('keeps frontmatter written in Obsidian when Markab edits the note', async () => {
    vault.obsidianWrite('Tagged.md', '---\ntags: [work]\n---\nbody')
    await app.sync()
    const note = app.byTitle('Tagged')!
    expect(note.content).toBe('body')
    app.edit(note.id, { content: 'body edited' })
    await app.write(note.id)
    expect(vault.text('Tagged.md')).toBe('---\ntags: [work]\n---\nbody edited')
  })

  it('moves files written by the first Markab build to Obsidian names', async () => {
    const n = app.add('Old note', 'kept')
    app.notes.set(n.id, { ...n, syncedFilename: 'old-note-abcd.md', syncedFolderPath: '' })
    vault.obsidianWrite('old-note-abcd.md', `---\nid: ${n.id}\ntitle: "Old note"\ncreatedAt: x\nupdatedAt: y\ntags: []\n---\nkept`)
    await app.sync()
    expect(vault.text('Old note.md')).toBe('kept')
    expect(vault.text('old-note-abcd.md')).toBeUndefined()
  })
})

describe('stage 2 — reading the vault', () => {
  it('imports notes and folders created in Obsidian', async () => {
    vault.obsidianWrite('Daily/2026-11-26.md', '- [ ] call')
    vault.obsidianWrite('Inbox.md', 'hello')
    const r = await app.sync()
    expect(r.stats.imported).toBe(2)
    const daily = app.byTitle('2026-11-26')!
    expect(daily.content).toBe('- [ ] call')
    expect(app.folders.find((f) => f.id === daily.folderId)?.name).toBe('Daily')
    expect(app.byTitle('Inbox')!.folderId).toBeNull()
  })

  it('a second sync with nothing changed does nothing', async () => {
    vault.obsidianWrite('A.md', 'a')
    app.add('B', 'b')
    await app.sync()
    const files = new Map(vault.files)
    const r = await app.sync()
    expect(r.upserts).toEqual([])
    expect(r.toWrite).toEqual([])
    expect(vault.files).toEqual(files)
  })

  it('picks up edits made in Obsidian', async () => {
    const n = app.add('Note', 'v1')
    await app.sync()
    vault.obsidianWrite('Note.md', 'v2 from Obsidian')
    const r = await app.sync()
    expect(r.stats.updated).toBe(1)
    expect(app.notes.get(n.id)!.content).toBe('v2 from Obsidian')
  })

  it('follows a file renamed or moved in Obsidian', async () => {
    const n = app.add('Note', 'same text')
    await app.sync()
    vault.obsidianRename('Note.md', 'Archive/Renamed.md')
    const r = await app.sync()
    expect(r.stats.moved).toBe(1)
    const moved = app.notes.get(n.id)!
    expect(moved.title).toBe('Renamed')
    expect(app.folders.find((f) => f.id === moved.folderId)?.name).toBe('Archive')
    expect(app.notes.size).toBe(1)
  })

  it('deletes notes whose file was deleted in Obsidian', async () => {
    const n = app.add('Gone', 'x')
    await app.sync()
    vault.files.delete('Gone.md')
    const r = await app.sync()
    expect(r.removedNoteIds).toEqual([n.id])
    expect(app.notes.has(n.id)).toBe(false)
  })

  it('keeps a note deleted in Obsidian if it was edited in Markab since', async () => {
    const n = app.add('Busy', 'x')
    await app.sync()
    vault.files.delete('Busy.md')
    app.edit(n.id, { content: 'new work' })
    await app.sync()
    expect(app.notes.get(n.id)!.content).toBe('new work')
    expect(vault.text('Busy.md')).toBe('new work')
  })

  it('edited on both sides in different places: merged automatically, no copy', async () => {
    const n = app.add('Plan', '# Plan\n\n- one\n- two\n\nnotes')
    await app.sync()
    vault.obsidianWrite('Plan.md', '# Plan\n\n- one\n- two\n- three from Obsidian\n\nnotes')
    app.edit(n.id, { content: '# Plan for the week\n\n- one\n- two\n\nnotes' })
    const r = await app.sync()
    expect(r.stats.merged).toBe(1)
    expect(r.stats.conflicts).toBe(0)
    const merged = '# Plan for the week\n\n- one\n- two\n- three from Obsidian\n\nnotes'
    expect(app.notes.get(n.id)!.content).toBe(merged)
    expect(vault.text('Plan.md')).toBe(merged)
    expect(app.notes.size).toBe(1)
    // And it stays settled.
    const again = await app.sync()
    expect(again.upserts).toEqual([])
    expect(again.toWrite).toEqual([])
  })

  it('merges edits around frontmatter added in Obsidian', async () => {
    const n = app.add('Doc', 'line 1\nline 2')
    await app.sync()
    vault.obsidianWrite('Doc.md', '---\ntags: [x]\n---\nline 1\nline 2')
    app.edit(n.id, { content: 'line 1\nline 2\nline 3' })
    await app.sync()
    const note = app.notes.get(n.id)!
    expect(note.frontmatter).toBe('---\ntags: [x]\n---\n')
    expect(note.content).toBe('line 1\nline 2\nline 3')
  })

  it('edited on both sides on the same line: Obsidian wins and Markab keeps its version as a copy', async () => {
    const n = app.add('Shared', 'base')
    await app.sync()
    vault.obsidianWrite('Shared.md', 'from Obsidian')
    app.edit(n.id, { content: 'from Markab' })
    const r = await app.sync()
    expect(r.stats.conflicts).toBe(1)
    expect(app.notes.get(n.id)!.content).toBe('from Obsidian')
    const copy = [...app.notes.values()].find((x) => x.title.startsWith('Shared (conflict'))!
    expect(copy.content).toBe('from Markab')
    expect(vault.text(app.states[copy.id]!.path)).toBe('from Markab')
  })

  it('never overwrites a file edited in Obsidian since Markab last saw it', async () => {
    const n = app.add('Note', 'v1')
    await app.sync()
    vault.obsidianWrite('Note.md', 'Obsidian edit')
    app.edit(n.id, { content: 'Markab edit' })
    expect((await app.write(n.id)).kind).toBe('changed-in-vault')
    expect(vault.text('Note.md')).toBe('Obsidian edit')
  })

  it('reconnecting to a vault that already has the same notes does not duplicate them', async () => {
    vault.obsidianWrite('Same.md', 'identical')
    app.add('Same', 'identical')
    await app.sync()
    expect(app.notes.size).toBe(1)
    expect(vault.files.size).toBe(1)
  })

  it('removes folders deleted in Obsidian once they are empty, and creates Markab folders in the vault', async () => {
    vault.obsidianWrite('Old/Note.md', 'x')
    await app.sync()
    vault.files.delete('Old/Note.md')
    vault.dirs.delete('Old')
    await app.sync()
    expect(app.folders.map((f) => f.name)).not.toContain('Old')

    app.folders = [...app.folders, { id: 'new', name: 'Fresh', parentId: null, createdAt: 0 }]
    await app.sync()
    expect(vault.dirs.has('Fresh')).toBe(true)
  })
})
