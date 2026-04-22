import type { Folder, Note } from '../types'
import { idbGet, idbSet, idbDel } from './idb'

const HANDLE_KEY = 'vaultHandle'

declare global {
  interface Window {
    showDirectoryPicker: (options?: {
      mode?: 'read' | 'readwrite'
      startIn?: string
    }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemHandle {
    queryPermission: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
    requestPermission: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'untitled'
  )
}

export function noteFilename(note: Note): string {
  return `${slugify(note.title || 'untitled')}-${note.id.slice(0, 4)}.md`
}

export function folderPath(folderId: string | null, folders: Folder[]): string {
  if (!folderId) return ''
  const parts: string[] = []
  let current: Folder | undefined = folders.find((f) => f.id === folderId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(slugify(current.name))
    current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined
  }
  return parts.join('/')
}

export async function loadStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
  return handle ?? null
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  prompt = false,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if (!prompt) return false
  return (await handle.requestPermission(opts)) === 'granted'
}

export async function pickVault(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

export async function disconnectVault(): Promise<void> {
  await idbDel(HANDLE_KEY)
}

async function resolveFolderHandle(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  if (!path) return root
  let current = root
  for (const segment of path.split('/').filter(Boolean)) {
    current = await current.getDirectoryHandle(segment, { create: true })
  }
  return current
}

function serialize(note: Note): string {
  const frontmatter = [
    '---',
    `id: ${note.id}`,
    `title: ${JSON.stringify(note.title || 'Untitled')}`,
    `createdAt: ${new Date(note.createdAt).toISOString()}`,
    `updatedAt: ${new Date(note.updatedAt).toISOString()}`,
    note.tags.length ? `tags: [${note.tags.map((t) => JSON.stringify(t)).join(', ')}]` : 'tags: []',
    '---',
    '',
  ].join('\n')
  return frontmatter + (note.content ?? '')
}

export interface SyncLocation {
  folderPath: string
  filename: string
}

export async function writeNote(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folderPathStr: string,
  previous?: SyncLocation,
): Promise<SyncLocation> {
  const filename = noteFilename(note)
  if (previous && (previous.filename !== filename || previous.folderPath !== folderPathStr)) {
    const prevDir = await resolveFolderHandle(handle, previous.folderPath).catch(() => null)
    if (prevDir) await prevDir.removeEntry(previous.filename).catch(() => {})
  }
  const dir = await resolveFolderHandle(handle, folderPathStr)
  const fileHandle = await dir.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(serialize(note))
  await writable.close()
  return { folderPath: folderPathStr, filename }
}

export async function removeNote(
  handle: FileSystemDirectoryHandle,
  loc: SyncLocation,
): Promise<void> {
  const dir = await resolveFolderHandle(handle, loc.folderPath).catch(() => null)
  if (!dir) return
  await dir.removeEntry(loc.filename).catch(() => {})
}

export async function syncAll(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<void> {
  for (const note of notes) {
    const path = folderPath(note.folderId, folders)
    await writeNote(handle, note, path)
  }
}
