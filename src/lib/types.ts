export interface Note {
  id: string
  title: string
  /** Markdown body. */
  content: string
  createdAt: number
  updatedAt: number
  tags: string[]
  folderId: string | null
  /** Where the note was last written in the Obsidian vault, so renames/moves can clean up. */
  syncedFilename?: string
  syncedFolderPath?: string
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
