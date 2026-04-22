import { create } from 'zustand'

export const FONT_MIN = 13
export const FONT_MAX = 22
export const FONT_DEFAULT = 16

export const WIDTH_OPTIONS = [
  { id: 'narrow', label: 'Narrow', value: 640 },
  { id: 'medium', label: 'Medium', value: 780 },
  { id: 'wide', label: 'Wide', value: 960 },
  { id: 'full', label: 'Full', value: 0 },
] as const

export type WidthId = (typeof WIDTH_OPTIONS)[number]['id']

interface PrefsState {
  fontSize: number
  widthId: WidthId
  isHydrated: boolean
  hydrate: () => Promise<void>
  setFontSize: (size: number) => void
  setWidth: (id: WidthId) => void
  resetTypography: () => void
}

const storageGet = <T>(key: string): Promise<T | undefined> =>
  new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] as T | undefined))
  })

const storageSet = (key: string, value: unknown): void => {
  chrome.storage.local.set({ [key]: value })
}

const clamp = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)))

export const useEditorPrefs = create<PrefsState>((set) => ({
  fontSize: FONT_DEFAULT,
  widthId: 'medium',
  isHydrated: false,

  hydrate: async () => {
    const prefs = await storageGet<{ fontSize?: number; widthId?: WidthId }>('editorPrefs')
    set({
      fontSize: prefs?.fontSize ? clamp(prefs.fontSize) : FONT_DEFAULT,
      widthId: prefs?.widthId ?? 'medium',
      isHydrated: true,
    })
  },

  setFontSize: (size) => {
    const fontSize = clamp(size)
    set({ fontSize })
    storageSet('editorPrefs', { fontSize, widthId: useEditorPrefs.getState().widthId })
  },

  setWidth: (widthId) => {
    set({ widthId })
    storageSet('editorPrefs', { fontSize: useEditorPrefs.getState().fontSize, widthId })
  },

  resetTypography: () => {
    set({ fontSize: FONT_DEFAULT, widthId: 'medium' })
    storageSet('editorPrefs', { fontSize: FONT_DEFAULT, widthId: 'medium' })
  },
}))
