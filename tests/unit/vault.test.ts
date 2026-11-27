import { describe, expect, it } from 'vitest'
import type { Folder } from '@/lib/types'
import {
  folderPath,
  legacyMarkabId,
  parseNoteFile,
  sanitizeFolderName,
  sanitizeName,
  serializeNote,
  stripLegacyFrontmatter,
} from '@/lib/vault'

const folders: Folder[] = [
  { id: 'root', name: 'Work Stuff', parentId: null, createdAt: 0 },
  { id: 'child', name: 'C# ideas', parentId: 'root', createdAt: 0 },
]

describe('vault names', () => {
  it('keeps titles as file names, dropping only what Obsidian forbids', () => {
    expect(sanitizeName('Café & Notes')).toBe('Café & Notes')
    expect(sanitizeName('a/b: c?')).toBe('ab c')
    expect(sanitizeName('[[link]] #tag ^block')).toBe('link tag block')
    expect(sanitizeName('  ')).toBe('Untitled')
    expect(sanitizeName('.hidden.')).toBe('hidden')
  })

  it('maps nested folders to directories, keeping characters folders allow', () => {
    expect(sanitizeFolderName('C# ideas')).toBe('C# ideas')
    expect(folderPath('child', folders)).toBe('Work Stuff/C# ideas')
    const cyclic: Folder[] = [
      { id: 'a', name: 'A', parentId: 'b', createdAt: 0 },
      { id: 'b', name: 'B', parentId: 'a', createdAt: 0 },
    ]
    expect(folderPath('a', cyclic)).toBe('B/A')
  })
})

describe('note files', () => {
  it('splits frontmatter verbatim and round-trips byte for byte', () => {
    const text = '---\ntags: [x]\naliases:\n  - y\n---\n# Body\n'
    const parsed = parseNoteFile(text)
    expect(parsed.frontmatter).toBe('---\ntags: [x]\naliases:\n  - y\n---\n')
    expect(parsed.body).toBe('# Body\n')
    expect(serializeNote({ frontmatter: parsed.frontmatter, content: parsed.body })).toBe(text)
  })

  it('treats a file without frontmatter as all body', () => {
    expect(parseNoteFile('hello\n---\nnot frontmatter')).toEqual({ body: 'hello\n---\nnot frontmatter' })
  })

  it('recognises and strips the frontmatter the first Markab build wrote', () => {
    const v1 = '---\nid: abc-123\ntitle: "Old"\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-02T00:00:00.000Z\ntags: []\n---\n'
    expect(legacyMarkabId(v1)).toBe('abc-123')
    expect(stripLegacyFrontmatter(v1)).toBeUndefined()
    expect(stripLegacyFrontmatter(v1.replace('tags: []', 'cssclass: wide'))).toBe('---\ncssclass: wide\n---\n')
    expect(legacyMarkabId('---\nid: mine\n---\n')).toBeNull() // a user's own `id` property
  })
})

describe('attachments', () => {
  it("follows Obsidian's \"default location for new attachments\"", async () => {
    const { attachmentDir } = await import('@/lib/vault')
    expect(attachmentDir(undefined, 'Notes/Daily')).toBe('')
    expect(attachmentDir('/', 'Notes/Daily')).toBe('')
    expect(attachmentDir('./', 'Notes/Daily')).toBe('Notes/Daily')
    expect(attachmentDir('./assets', 'Notes/Daily')).toBe('Notes/Daily/assets')
    expect(attachmentDir('Attachments', 'Notes/Daily')).toBe('Attachments')
    expect(attachmentDir('/Media/', '')).toBe('Media')
  })

  it('names pasted images like Obsidian', async () => {
    const { pastedImageName } = await import('@/lib/vault')
    expect(pastedImageName(new Date(2026, 10, 26, 19, 3, 7), 'png')).toBe('Pasted image 20261126190307.png')
  })

  it('resolves embeds by exact path, else the matching name closest to the root', async () => {
    const { resolveAttachment } = await import('@/lib/vault')
    const files = ['Assets/deep/cat.png', 'cat.png', 'Other/dog.jpg']
    expect(resolveAttachment('cat.png', files)).toBe('cat.png')
    expect(resolveAttachment('Assets/deep/cat.png', files)).toBe('Assets/deep/cat.png')
    expect(resolveAttachment('DOG.jpg', files)).toBe('Other/dog.jpg')
    expect(resolveAttachment('bird.png', files)).toBeNull()
  })
})
