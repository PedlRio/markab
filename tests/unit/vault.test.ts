import { describe, expect, it } from 'vitest'
import type { Folder, Note } from '@/lib/types'
import { folderPath, noteFilename, serialize, slugify } from '@/lib/vault'

const note: Note = {
  id: 'abcd1234',
  title: 'Café & Notes',
  content: 'Body',
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 2),
  tags: ['x'],
  folderId: 'child',
}
const folders: Folder[] = [
  { id: 'root', name: 'Work Stuff', parentId: null, createdAt: 0 },
  { id: 'child', name: 'Ideias', parentId: 'root', createdAt: 0 },
]

describe('vault paths', () => {
  it('slugifies titles, stripping accents', () => {
    expect(slugify('Café & Notes')).toBe('cafe-notes')
    expect(slugify('   ')).toBe('untitled')
  })

  it('names files from title + id prefix', () => {
    expect(noteFilename(note)).toBe('cafe-notes-abcd.md')
  })

  it('maps nested folders to directories and survives cycles', () => {
    expect(folderPath('child', folders)).toBe('work-stuff/ideias')
    const cyclic: Folder[] = [
      { id: 'a', name: 'A', parentId: 'b', createdAt: 0 },
      { id: 'b', name: 'B', parentId: 'a', createdAt: 0 },
    ]
    expect(folderPath('a', cyclic)).toBe('b/a')
  })

  it('writes YAML frontmatter', () => {
    expect(serialize(note)).toBe(
      '---\nid: abcd1234\ntitle: "Café & Notes"\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-02T00:00:00.000Z\ntags: ["x"]\n---\nBody',
    )
  })
})
