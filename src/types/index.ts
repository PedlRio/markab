export interface Note {
  id: string
  title: string
  filename: string
  content: string
  createdAt: number
  updatedAt: number
  tags: string[]
  folderId: string | null
  syncedFilename?: string
  syncedFolderPath?: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface VaultConfig {
  connected: boolean
  lastSyncedAt: number | null
  vaultName: string | null
}

export type ExtensionMessage =
  | { type: 'GET_NOTES' }
  | { type: 'NOTES_RESPONSE'; payload: Note[] }
  | { type: 'CREATE_NOTE'; payload: Omit<Note, 'id' | 'createdAt' | 'updatedAt'> }
  | { type: 'UPDATE_NOTE'; payload: Note }
  | { type: 'DELETE_NOTE'; payload: { id: string } }
  | { type: 'GET_VAULT_STATUS' }
  | { type: 'VAULT_STATUS_RESPONSE'; payload: { connected: boolean; lastSyncedAt: number | null } }
