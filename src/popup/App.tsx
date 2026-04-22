import { useEffect, useState } from 'react'
import type { Note } from '../types'

interface PopupState {
  noteCount: number
  vaultName: string | null
  lastSyncedAt: number | null
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never'
  const delta = Date.now() - ts
  const m = Math.floor(delta / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function App() {
  const [state, setState] = useState<PopupState>({
    noteCount: 0,
    vaultName: null,
    lastSyncedAt: null,
  })

  useEffect(() => {
    document.documentElement.classList.add('dark')
    chrome.storage.local.get(['notes', 'vaultMeta'], (result) => {
      const notes = (result['notes'] as Note[] | undefined) ?? []
      const meta = result['vaultMeta'] as
        | { vaultName: string | null; lastSyncedAt: number | null }
        | undefined
      setState({
        noteCount: notes.length,
        vaultName: meta?.vaultName ?? null,
        lastSyncedAt: meta?.lastSyncedAt ?? null,
      })
    })
  }, [])

  const openNewTab = () => {
    chrome.tabs.create({ url: 'chrome://newtab' })
    window.close()
  }

  const connected = Boolean(state.vaultName)

  return (
    <div className="bg-zinc-950 text-zinc-200 p-4 w-64">
      <h1 className="text-sm font-semibold mb-3 text-zinc-300">new-tab-mark</h1>

      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Notes saved</span>
          <span className="font-medium tabular-nums text-zinc-200">{state.noteCount}</span>
        </div>

        <div className="flex items-center justify-between text-sm gap-2">
          <span className="text-zinc-500 flex-shrink-0">Vault</span>
          <span
            className={`flex items-center gap-1.5 font-medium truncate ${
              connected ? 'text-green-400' : 'text-zinc-600'
            }`}
            title={state.vaultName ?? 'Disconnected'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                connected ? 'bg-green-500' : 'bg-zinc-700'
              }`}
            />
            <span className="truncate">{connected ? state.vaultName : 'Disconnected'}</span>
          </span>
        </div>

        {connected && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Last sync</span>
            <span className="text-zinc-400">{formatRelative(state.lastSyncedAt)}</span>
          </div>
        )}
      </div>

      <button
        onClick={openNewTab}
        className="w-full py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm rounded-md transition-colors border border-zinc-700"
      >
        Open New Tab
      </button>
    </div>
  )
}
