import { useEffect } from 'react'
import { useNotes } from '@/store/notes'

export function PrivacyOverlay() {
  const isHidden = useNotes((s) => s.isHidden)
  const setHidden = useNotes((s) => s.setHidden)
  const toggleHidden = useNotes((s) => s.toggleHidden)

  useEffect(() => {
    // Capture phase so ⌘⇧H wins over the editor's own shortcuts.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        e.stopPropagation()
        toggleHidden()
      } else if (isHidden && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        setHidden(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isHidden, setHidden, toggleHidden])

  if (!isHidden) return null

  return (
    <button
      type="button"
      onClick={() => setHidden(false)}
      className="fixed inset-0 z-60 flex cursor-pointer select-none flex-col items-center justify-center gap-3 bg-zinc-950/95 backdrop-blur-xl"
      aria-label="Reveal notes"
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zinc-500"
        aria-hidden
      >
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
      <span className="text-base font-medium text-zinc-300">Notes hidden</span>
      <span className="text-xs text-zinc-600">Click, press Enter or ⌘⇧H to reveal</span>
    </button>
  )
}
