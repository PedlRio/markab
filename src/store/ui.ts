import { create } from 'zustand'
import { useNotes } from './notes'

/** Workspace chrome state: sidebar, settings modal, back/forward history. Per-browser, not synced. */

export type SidebarTab = 'files' | 'search'

const LAYOUT_KEY = 'markab:layout'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 520

interface Layout {
  sidebarOpen: boolean
  sidebarWidth: number
}

const loadLayout = (): Layout => {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<Layout>
    return {
      sidebarOpen: raw.sidebarOpen ?? true,
      sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw.sidebarWidth ?? 280)),
    }
  } catch {
    return { sidebarOpen: true, sidebarWidth: 280 }
  }
}

const saveLayout = (layout: Layout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // ignore
  }
}

interface UiState extends Layout {
  sidebarTab: SidebarTab
  settingsOpen: boolean
  history: string[]
  historyIndex: number
  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  showSidebarTab: (tab: SidebarTab) => void
  setSettingsOpen: (open: boolean) => void
  goBack: () => void
  goForward: () => void
}

let navigatingHistory = false

export const useUi = create<UiState>()((set, get) => ({
  ...loadLayout(),
  sidebarTab: 'files',
  settingsOpen: false,
  history: [],
  historyIndex: -1,

  toggleSidebar: () => {
    const sidebarOpen = !get().sidebarOpen
    set({ sidebarOpen })
    saveLayout({ sidebarOpen, sidebarWidth: get().sidebarWidth })
  },
  setSidebarWidth: (w) => {
    const sidebarWidth = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
    set({ sidebarWidth })
    saveLayout({ sidebarOpen: get().sidebarOpen, sidebarWidth })
  },
  showSidebarTab: (sidebarTab) => {
    set({ sidebarTab, sidebarOpen: true })
    saveLayout({ sidebarOpen: true, sidebarWidth: get().sidebarWidth })
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  goBack: () => go(-1),
  goForward: () => go(1),
}))

function go(delta: number) {
  const { history, historyIndex } = useUi.getState()
  const notes = useNotes.getState().notes
  let i = historyIndex + delta
  // Skip notes deleted since they were visited.
  while (i >= 0 && i < history.length && !notes.some((n) => n.id === history[i])) i += delta
  if (i < 0 || i >= history.length) return
  navigatingHistory = true
  useUi.setState({ historyIndex: i })
  useNotes.getState().setActiveNote(history[i]!)
  navigatingHistory = false
}

// Record every note the user opens, like a browser history.
useNotes.subscribe((state, prev) => {
  const id = state.activeNoteId
  if (!id || id === prev.activeNoteId || navigatingHistory) return
  const { history, historyIndex } = useUi.getState()
  if (history[historyIndex] === id) return
  const next = [...history.slice(0, historyIndex + 1), id].slice(-100)
  useUi.setState({ history: next, historyIndex: next.length - 1 })
})
