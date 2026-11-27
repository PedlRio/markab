export interface Note {
  id: string
  title: string
  /** Markdown body. */
  content: string
  createdAt: number
  updatedAt: number
  tags: string[]
  folderId: string | null
  /** YAML frontmatter block exactly as found in the vault file (`---\n…\n---\n`), kept verbatim. */
  frontmatter?: string
  /** @deprecated v1 vault location; read once to migrate into `NoteSyncState`. */
  syncedFilename?: string
  /** @deprecated see `syncedFilename`. */
  syncedFolderPath?: string
}

/**
 * Where a note lives in the Obsidian vault and which version of it is there. Stored apart
 * from the note (`vault:<id>`) so syncing never rewrites the note while it is being edited.
 */
export interface NoteSyncState {
  /** Vault path, e.g. `Projects/Idea.md`. */
  path: string
  /** The file's lastModified right after Markab last wrote or read it. */
  mtime: number
  /** The note's `updatedAt` that the file currently holds. */
  version: number
  /** The file's text as of the last sync: the common ancestor for merging edits made on both sides. */
  base?: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface VaultMeta {
  vaultName: string | null
  lastSyncedAt: number | null
}

export interface Prefs {
  fontSize: number
  widthId: WidthId
  /** Start every new tab behind the privacy overlay. */
  hideOnOpen: boolean
  /** `livePreview` = Obsidian-style CodeMirror editor; `classic` = the Tiptap editor. */
  editor: EditorEngine
}

export type EditorEngine = 'livePreview' | 'classic'

export type WidthId = 'narrow' | 'medium' | 'wide' | 'full'
