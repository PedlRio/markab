import { useEffect } from 'react'
import { useNoteStore } from '../../store/noteStore'

export function PrivacyOverlay() {
  const isHidden = useNoteStore((s) => s.isHidden)
  const reveal = useNoteStore((s) => s.reveal)
  const toggle = useNoteStore((s) => s.toggleHidden)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggle])

  if (!isHidden) return null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={reveal}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && reveal()}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-zinc-950/95 backdrop-blur-xl cursor-pointer select-none"
      aria-label="Click to reveal notes"
    >
      <div className="flex flex-col items-center gap-3">
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
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <p className="text-zinc-300 text-base font-medium">Notes hidden</p>
        <p className="text-zinc-600 text-xs">Click anywhere or press ⌘⇧H to reveal</p>
      </div>
    </div>
  )
}
