import { EyeOff, FilePlus, Files, PanelLeft, Search, Settings } from 'lucide-react'
import { useNotes } from '@/store/notes'
import { useUi } from '@/store/ui'
import { ClickableIcon } from './ui'

/** Obsidian's left ribbon: a thin vertical strip of actions next to the sidebar. */
export function Ribbon() {
  const createNote = useNotes((s) => s.createNote)
  const setHidden = useNotes((s) => s.setHidden)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const sidebarTab = useUi((s) => s.sidebarTab)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const showSidebarTab = useUi((s) => s.showSidebarTab)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)

  return (
    <nav
      aria-label="Ribbon"
      className="flex w-(--ribbon-width) shrink-0 flex-col items-center justify-between border-r border-(--divider-color) bg-(--ribbon-background) py-2"
    >
      <div className="flex flex-col items-center gap-1">
        <ClickableIcon icon={PanelLeft} label="Toggle left sidebar" onClick={toggleSidebar} />
        <div className="my-1 h-px w-5 bg-(--divider-color)" />
        <ClickableIcon
          icon={Files}
          label="Files"
          active={sidebarOpen && sidebarTab === 'files'}
          onClick={() => showSidebarTab('files')}
        />
        <ClickableIcon
          icon={Search}
          label="Search"
          active={sidebarOpen && sidebarTab === 'search'}
          onClick={() => showSidebarTab('search')}
        />
        <ClickableIcon icon={FilePlus} label="New note" onClick={() => createNote()} />
      </div>
      <div className="flex flex-col items-center gap-1">
        <ClickableIcon icon={EyeOff} label="Hide notes (⌘⇧H)" onClick={() => setHidden(true)} />
        <ClickableIcon icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} />
      </div>
    </nav>
  )
}
