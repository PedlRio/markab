import { useRef, useState } from 'react'
import { buildBackup, parseBackup } from '@/lib/storage'
import { useNotes } from '@/store/notes'
import { FONT_MAX, FONT_MIN, usePrefs, WIDTH_OPTIONS } from '@/store/prefs'
import { useUi } from '@/store/ui'
import { Modal, Segmented, SettingItem, Toggle } from './ui'

const button =
  'rounded-md bg-(--background-modifier-form-field) px-3 py-1.5 text-xs text-(--text-normal) transition-colors hover:bg-(--background-modifier-hover) disabled:opacity-50'
const accentButton =
  'rounded-md bg-(--interactive-accent) px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50'

function relative(ts: number | null) {
  if (!ts) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  if (!open) return null
  return (
    <Modal title="Settings" onClose={() => setOpen(false)}>
      <Section title="Editor">
        <EditorSettings />
      </Section>
      <Section title="Obsidian vault">
        <VaultSettings />
      </Section>
      <Section title="Backup">
        <BackupSettings />
      </Section>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-(--text-faint)">{title}</h3>
      {children}
    </section>
  )
}

function EditorSettings() {
  const prefs = usePrefs()
  return (
    <>
      <SettingItem name="Editor" description="Live Preview edits Markdown like Obsidian. Classic is a rich-text editor.">
        <Segmented
          label="Editor"
          value={prefs.editor}
          onChange={(editor) => prefs.update({ editor })}
          options={[
            { id: 'livePreview', label: 'Live Preview' },
            { id: 'classic', label: 'Classic' },
          ]}
        />
      </SettingItem>
      <SettingItem name="Font size" description={`${prefs.fontSize}px`}>
        <input
          type="range"
          min={FONT_MIN}
          max={FONT_MAX}
          value={prefs.fontSize}
          aria-label="Font size"
          onChange={(e) => prefs.update({ fontSize: Number(e.target.value) })}
          className="mk-range w-40"
        />
      </SettingItem>
      <SettingItem name="Readable line length" description="Limits how wide the text column gets.">
        <Segmented
          label="Line width"
          value={prefs.widthId}
          onChange={(widthId) => prefs.update({ widthId })}
          options={WIDTH_OPTIONS.map((w) => ({ id: w.id, label: w.label }))}
        />
      </SettingItem>
      <SettingItem name="Hide notes when a new tab opens" description="Shows a privacy screen until you click or press ⌘⇧H.">
        <Toggle
          label="Hide notes when a new tab opens"
          checked={prefs.hideOnOpen}
          onChange={(hideOnOpen) => prefs.update({ hideOnOpen })}
        />
      </SettingItem>
    </>
  )
}

function VaultSettings() {
  const status = useNotes((s) => s.vaultStatus)
  const vaultName = useNotes((s) => s.vaultName)
  const lastSyncedAt = useNotes((s) => s.lastSyncedAt)
  const syncError = useNotes((s) => s.syncError)
  const syncReport = useNotes((s) => s.syncReport)
  const { connectVault, reauthorizeVault, disconnectVault, resyncVault } = useNotes.getState()
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingItem
        name={status === 'disconnected' ? 'Not connected' : (vaultName ?? 'Vault')}
        description={
          status === 'disconnected'
            ? 'Keep notes in sync with your Obsidian vault: each note is a .md file there, and edits made in Obsidian show up here.'
            : status === 'needs-permission'
              ? 'Chrome needs your permission again to write to this folder.'
              : `Synced ${relative(lastSyncedAt)}`
        }
      >
        <div className="flex gap-2">
          {status === 'disconnected' && (
            <button className={accentButton} disabled={busy} onClick={run(connectVault)}>
              Connect vault
            </button>
          )}
          {status === 'needs-permission' && (
            <button className={accentButton} disabled={busy} onClick={run(reauthorizeVault)}>
              Allow access
            </button>
          )}
          {status === 'connected' && (
            <button className={button} disabled={busy} onClick={run(resyncVault)}>
              Resync
            </button>
          )}
          {status !== 'disconnected' && (
            <button className={button} disabled={busy} onClick={run(disconnectVault)}>
              Disconnect
            </button>
          )}
        </div>
      </SettingItem>
      {syncReport && status === 'connected' && <p className="pb-2 text-xs text-(--text-muted)">{syncReport}</p>}
      {syncError && <p className="pb-2 text-xs text-(--color-red)">{syncError}</p>}
    </>
  )
}

function BackupSettings() {
  const importNotes = useNotes((s) => s.importNotes)
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  const exportBackup = () => {
    const { notes, folders } = useNotes.getState()
    const blob = new Blob([JSON.stringify(buildBackup(notes, folders), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `markab-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const importBackup = async (file: File) => {
    try {
      const { notes, folders } = parseBackup(JSON.parse(await file.text()))
      importNotes(notes, folders)
      setMessage(`Imported ${notes.length} note${notes.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setMessage(`Could not import: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <>
      <SettingItem name="Export" description="Download every note and folder as a JSON file.">
        <button className={button} onClick={exportBackup}>
          Export backup
        </button>
      </SettingItem>
      <SettingItem name="Import" description="Merge a backup file. Newer versions of a note win.">
        <button className={button} onClick={() => fileInput.current?.click()}>
          Import backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importBackup(file)
            e.target.value = ''
          }}
        />
      </SettingItem>
      {message && <p className="pb-2 text-xs text-(--text-muted)">{message}</p>}
    </>
  )
}
