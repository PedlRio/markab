import { create } from 'zustand'
import * as storage from '@/lib/storage'
import type { Prefs, WidthId } from '@/lib/types'

export const FONT_MIN = 13
export const FONT_MAX = 22

export const WIDTH_OPTIONS: ReadonlyArray<{ id: WidthId; label: string; value: number | null }> = [
  { id: 'narrow', label: 'Narrow', value: 640 },
  { id: 'medium', label: 'Medium', value: 780 },
  { id: 'wide', label: 'Wide', value: 960 },
  { id: 'full', label: 'Full', value: null },
]

export const DEFAULT_PREFS: Prefs = { fontSize: 16, widthId: 'medium', hideOnOpen: true, editor: 'livePreview' }

const clampFont = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)))

export function normalizePrefs(raw: Partial<Prefs> | undefined): Prefs {
  return {
    fontSize: typeof raw?.fontSize === 'number' ? clampFont(raw.fontSize) : DEFAULT_PREFS.fontSize,
    widthId: WIDTH_OPTIONS.some((w) => w.id === raw?.widthId) ? raw!.widthId! : DEFAULT_PREFS.widthId,
    hideOnOpen: typeof raw?.hideOnOpen === 'boolean' ? raw.hideOnOpen : DEFAULT_PREFS.hideOnOpen,
    editor: raw?.editor === 'classic' || raw?.editor === 'livePreview' ? raw.editor : DEFAULT_PREFS.editor,
  }
}

interface PrefsStore extends Prefs {
  load: () => Promise<Prefs>
  update: (patch: Partial<Prefs>) => void
  reset: () => void
}

const pick = ({ fontSize, widthId, hideOnOpen, editor }: Prefs): Prefs => ({ fontSize, widthId, hideOnOpen, editor })

export const usePrefs = create<PrefsStore>()((set, get) => ({
  ...DEFAULT_PREFS,

  load: async () => {
    const { prefs } = await storage.loadSnapshot()
    const normalized = normalizePrefs(prefs)
    set(normalized)
    storage.subscribe({ prefsChanged: (p) => set(normalizePrefs(p)) })
    return normalized
  },

  update: (patch) => {
    const next = normalizePrefs({ ...pick(get()), ...patch })
    set(next)
    void storage.savePrefs(next)
  },

  reset: () => {
    const { hideOnOpen, editor } = get()
    get().update({ ...DEFAULT_PREFS, hideOnOpen, editor })
  },
}))
