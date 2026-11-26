import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { loadSnapshot, parseBackup, saveNote, SCHEMA_VERSION, subscribe } from '@/lib/storage'
import type { Note } from '@/lib/types'

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: `Note ${id}`,
  content: `# ${id}`,
  createdAt: 1,
  updatedAt: 1,
  tags: [],
  folderId: null,
  ...over,
})

describe('storage', () => {
  beforeEach(() => fakeBrowser.reset())

  it('migrates the v1 single-array layout to one key per note', async () => {
    await fakeBrowser.storage.local.set({
      notes: [{ ...note('a'), filename: 'note-a.md' }, { ...note('b'), folderId: undefined }],
      editorPrefs: { fontSize: 18, widthId: 'wide' },
    })

    const snap = await loadSnapshot()

    expect(snap.notes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(snap.notes.find((n) => n.id === 'b')!.folderId).toBeNull()
    expect(snap.prefs).toEqual({ fontSize: 18, widthId: 'wide' })
    const raw = await fakeBrowser.storage.local.get(null)
    expect(raw.notes).toBeUndefined()
    expect(raw.editorPrefs).toBeUndefined()
    expect(raw.schema).toBe(SCHEMA_VERSION)
    expect(raw['note:a']).not.toHaveProperty('filename')
  })

  it('still migrates legacy notes when the schema marker is already set', async () => {
    await fakeBrowser.storage.local.set({
      schema: SCHEMA_VERSION,
      notes: [note('late')],
      'note:newer': note('newer', { updatedAt: 5 }),
    })
    await fakeBrowser.storage.local.set({ notes: [note('late'), note('newer', { updatedAt: 1 })] })
    const snap = await loadSnapshot()
    expect(snap.notes.map((n) => n.id).sort()).toEqual(['late', 'newer'])
    expect(snap.notes.find((n) => n.id === 'newer')!.updatedAt).toBe(5)
  })

  it('keeps notes written by different tabs (no whole-array overwrite)', async () => {
    await saveNote(note('tab1'))
    await saveNote(note('tab2'))
    const snap = await loadSnapshot()
    expect(snap.notes.map((n) => n.id).sort()).toEqual(['tab1', 'tab2'])
  })

  it('notifies subscribers about note changes and removals', async () => {
    const changed: string[] = []
    const removed: string[] = []
    const stop = subscribe({
      noteChanged: (n) => changed.push(n.id),
      noteRemoved: (id) => removed.push(id),
    })
    await saveNote(note('x'))
    await fakeBrowser.storage.local.remove('note:x')
    stop()
    expect(changed).toEqual(['x'])
    expect(removed).toEqual(['x'])
  })

  it('validates backup files', () => {
    expect(() => parseBackup({ hello: 1 })).toThrow()
    const { notes } = parseBackup({ notes: [note('ok'), { id: 1 }, { id: 'no-content' }] })
    expect(notes.map((n) => n.id)).toEqual(['ok'])
  })
})
