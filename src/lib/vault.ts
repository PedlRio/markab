import { idbDel, idbGet, idbSet } from './idb'
import type { Folder } from './types'

/**
 * The Obsidian vault on disk, through the File System Access API.
 *
 * Everything outside this file talks to the vault through the small `VaultFs` interface
 * (paths like `Projects/Idea.md`), so the sync logic can be unit-tested with an in-memory
 * vault and run for real against a user-picked folder.
 */

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

// ─── Names & paths (Obsidian conventions) ──────────────────────────────────

/**
 * A note title or folder name as Obsidian would accept it for a file name.
 * Obsidian forbids `\ / :` (file system) and `* " < > | ? # ^ [ ]` (link syntax).
 */
export function sanitizeName(name: string): string {
  const clean = name
    .replace(/[\\/:*"<>|?#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 200)
  return clean || 'Untitled'
}

/**
 * A folder name safe for every OS. Unlike note names, Obsidian allows `#`, `^`, `[` … in
 * folder names, so only characters no file system accepts are removed.
 */
export function sanitizeFolderName(name: string): string {
  const clean = name.replace(/[\\/:*"<>|?]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return clean || 'Untitled'
}

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/')
export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')
export const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '')

/** Vault directory of a Markab folder, e.g. `Projects/Markab`. */
export function folderPath(folderId: string | null, folders: Folder[]): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (let id = folderId; id && !seen.has(id); ) {
    seen.add(id)
    const folder = folders.find((f) => f.id === id)
    if (!folder) break
    parts.unshift(sanitizeFolderName(folder.name))
    id = folder.parentId
  }
  return parts.join('/')
}

// ─── File contents ──────────────────────────────────────────────────────────

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/** Split a note file into its YAML frontmatter block (kept verbatim) and the body. */
export function parseNoteFile(text: string): { frontmatter?: string; body: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) return { body: text }
  return { frontmatter: match[0], body: text.slice(match[0].length) }
}

/** What a note looks like on disk: its frontmatter exactly as found, then the body. */
export const serializeNote = (note: { frontmatter?: string; content: string }) =>
  (note.frontmatter ?? '') + note.content

/**
 * The first Markab build wrote its own frontmatter (`id`, `title`, `createdAt`, `updatedAt`,
 * `tags`). Returns that id so those files can be matched back to their notes.
 */
export function legacyMarkabId(frontmatter: string | undefined): string | null {
  if (!frontmatter || !/^createdAt: /m.test(frontmatter) || !/^updatedAt: /m.test(frontmatter)) return null
  return /^id: (\S+)\s*$/m.exec(frontmatter)?.[1] ?? null
}

/** Drop the keys the first Markab build added, keeping anything else the user put there. */
export function stripLegacyFrontmatter(frontmatter: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/)
  const kept = lines.filter(
    (l) => !/^(id|title|createdAt|updatedAt): /.test(l) && !/^tags: \[\]\s*$/.test(l),
  )
  const inner = kept.filter((l) => l !== '---' && l.trim() !== '')
  return inner.length ? kept.join('\n') : undefined
}

// ─── Attachments (Obsidian conventions) ─────────────────────────────────────

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

/**
 * Where a new attachment goes, from Obsidian's "Default location for new attachments"
 * (`attachmentFolderPath` in .obsidian/app.json): `/` vault root (default), `./` the note's
 * folder, `./sub` a subfolder of it, or `Folder` a fixed folder.
 */
export function attachmentDir(setting: string | undefined, noteDir: string): string {
  const s = (setting ?? '/').trim()
  if (s === '' || s === '/') return ''
  if (s === '.' || s === './') return noteDir
  if (s.startsWith('./')) return joinPath(noteDir, s.slice(2).replace(/\/+$/, ''))
  return s.replace(/^\/+|\/+$/g, '')
}

/** Obsidian names pasted images `Pasted image 20261126193012.png`. */
export function pastedImageName(date: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `Pasted image ${stamp}.${ext}`
}

const fileName = (path: string) => path.split('/').pop()!

/**
 * Resolve an embed like `![[cat.png]]` the way Obsidian does: an exact vault path wins,
 * otherwise the file with that name closest to the vault root.
 */
export function resolveAttachment(name: string, attachments: string[]): string | null {
  const wanted = name.replace(/^\/+/, '')
  if (attachments.includes(wanted)) return wanted
  const matches = attachments.filter((p) => fileName(p).toLowerCase() === fileName(wanted).toLowerCase())
  if (!matches.length) return null
  return matches.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]!
}

// ─── File system access ─────────────────────────────────────────────────────

export interface VaultFile {
  path: string
  lastModified: number
}

export interface VaultFs {
  /**
   * Every Markdown file, directory and attachment (any other file), skipping hidden ones
   * (`.obsidian`, `.trash`, …).
   */
  list(): Promise<{ files: VaultFile[]; dirs: string[]; attachments: string[] }>
  read(path: string): Promise<{ text: string; lastModified: number }>
  /** Last-modified time of a file, or null when it doesn't exist. */
  stat(path: string): Promise<number | null>
  /** Writes (creating folders as needed) and returns the new last-modified time. */
  write(path: string, text: string): Promise<number>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  /** Remove the directory at `path` (and empty subdirectories) if it holds no files. */
  removeEmptyTree(path: string): Promise<void>
  readBlob(path: string): Promise<Blob>
  writeBlob(path: string, data: Blob): Promise<void>
  /** Obsidian's own settings that Markab follows (from `.obsidian/app.json`). */
  readConfig(): Promise<{ attachmentFolderPath?: string }>
}

const isHidden = (name: string) => name.startsWith('.')

export function createVaultFs(root: FileSystemDirectoryHandle): VaultFs {
  const dir = async (path: string, create: boolean) => {
    let current = root
    for (const segment of path.split('/').filter(Boolean)) {
      current = await current.getDirectoryHandle(segment, { create })
    }
    return current
  }
  const file = async (path: string, create = false) =>
    (await dir(dirOf(path), create)).getFileHandle(path.split('/').pop()!, { create })

  return {
    async list() {
      const files: VaultFile[] = []
      const dirs: string[] = []
      const attachments: string[] = []
      const walk = async (handle: FileSystemDirectoryHandle, prefix: string) => {
        for await (const entry of handle.values()) {
          if (isHidden(entry.name)) continue
          const path = joinPath(prefix, entry.name)
          if (entry.kind === 'directory') {
            dirs.push(path)
            await walk(entry as FileSystemDirectoryHandle, path)
          } else if (/\.md$/i.test(entry.name)) {
            files.push({ path, lastModified: (await (entry as FileSystemFileHandle).getFile()).lastModified })
          } else {
            attachments.push(path)
          }
        }
      }
      await walk(root, '')
      return { files, dirs, attachments }
    },
    async read(path) {
      const f = await (await file(path)).getFile()
      return { text: await f.text(), lastModified: f.lastModified }
    },
    async stat(path) {
      try {
        return (await (await file(path)).getFile()).lastModified
      } catch {
        return null
      }
    },
    async write(path, text) {
      const handle = await file(path, true)
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return (await handle.getFile()).lastModified
    },
    async remove(path) {
      try {
        await (await dir(dirOf(path), false)).removeEntry(path.split('/').pop()!)
      } catch {
        // already gone
      }
    },
    async readBlob(path) {
      return (await file(path)).getFile()
    },
    async writeBlob(path, data) {
      const writable = await (await file(path, true)).createWritable()
      await writable.write(data)
      await writable.close()
    },
    async readConfig() {
      try {
        const handle = await (await root.getDirectoryHandle('.obsidian')).getFileHandle('app.json')
        return JSON.parse(await (await handle.getFile()).text()) as { attachmentFolderPath?: string }
      } catch {
        return {}
      }
    },
    async mkdir(path) {
      await dir(path, true)
    },
    async removeEmptyTree(path) {
      if (!path) return
      const prune = async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
        let empty = true
        for await (const entry of handle.values()) {
          if (entry.kind === 'directory' && (await prune(entry as FileSystemDirectoryHandle))) {
            await handle.removeEntry(entry.name)
          } else {
            empty = false
          }
        }
        return empty
      }
      try {
        const target = await dir(path, false)
        if (await prune(target)) await (await dir(dirOf(path), false)).removeEntry(path.split('/').pop()!)
      } catch {
        // missing or not removable — leave it
      }
    },
  }
}

// ─── Handle persistence & permission ───────────────────────────────────────

export async function loadStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
  return handle ?? null
}

/**
 * Chrome forgets File System Access grants between sessions, so a stored handle usually
 * comes back as 'prompt'. Only `requestPermission` inside a user gesture (a click) can
 * turn it back into 'granted' — never call it with `prompt = true` outside a click handler.
 */
export async function verifyPermission(handle: FileSystemDirectoryHandle, prompt = false): Promise<boolean> {
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
