import { useEffect, useRef, useState } from 'react'
import {
  FONT_MAX,
  FONT_MIN,
  WIDTH_OPTIONS,
  useEditorPrefs,
  type WidthId,
} from '../../store/prefsStore'

export function TypographyPopover() {
  const [open, setOpen] = useState(false)
  const fontSize = useEditorPrefs((s) => s.fontSize)
  const widthId = useEditorPrefs((s) => s.widthId)
  const setFontSize = useEditorPrefs((s) => s.setFontSize)
  const setWidth = useEditorPrefs((s) => s.setWidth)
  const resetTypography = useEditorPrefs((s) => s.resetTypography)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const dec = () => setFontSize(fontSize - 1)
  const inc = () => setFontSize(fontSize + 1)

  return (
    <div ref={rootRef} className="absolute top-4 right-4 z-20">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Typography settings"
        className={`group flex items-center justify-center w-8 h-8 rounded-full border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 transition-all ${
          open ? 'text-zinc-100 border-zinc-700 bg-zinc-900/90' : ''
        }`}
      >
        <span className="text-[13px] font-semibold tracking-tight leading-none">
          <span className="text-[15px]">A</span>
          <span className="text-[10px] align-baseline">a</span>
        </span>
      </button>

      {open && (
        <div className="ntm-popover absolute top-10 right-0 w-[260px] rounded-xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/60 p-4">
          <div className="space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                  Font size
                </label>
                <span className="text-xs text-zinc-400 font-mono tabular-nums">{fontSize}px</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={dec}
                  disabled={fontSize <= FONT_MIN}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Decrease font size"
                >
                  <span className="text-xs">A</span>
                </button>
                <input
                  type="range"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="flex-1 ntm-range"
                  aria-label="Font size"
                />
                <button
                  onClick={inc}
                  disabled={fontSize >= FONT_MAX}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Increase font size"
                >
                  <span className="text-base font-semibold">A</span>
                </button>
              </div>
            </section>

            <section>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium block mb-2">
                Width
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800">
                {WIDTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setWidth(opt.id as WidthId)}
                    className={`relative flex flex-col items-center justify-center py-2 rounded-md transition ${
                      widthId === opt.id
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    aria-pressed={widthId === opt.id}
                  >
                    <WidthIcon id={opt.id} />
                    <span className="text-[10px] mt-1">{opt.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <button
              onClick={resetTypography}
              className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 py-1.5 rounded-md hover:bg-zinc-800/50 transition"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function WidthIcon({ id }: { id: string }) {
  const bars: Record<string, number> = { narrow: 8, medium: 12, wide: 16, full: 20 }
  const w = bars[id] ?? 12
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" className="opacity-80">
      <rect
        x={(22 - w) / 2}
        y="3"
        width={w}
        height="1.5"
        rx="0.75"
        fill="currentColor"
      />
      <rect
        x={(22 - w) / 2}
        y="6.5"
        width={w}
        height="1.5"
        rx="0.75"
        fill="currentColor"
      />
      <rect
        x={(22 - w) / 2}
        y="10"
        width={w * 0.7}
        height="1.5"
        rx="0.75"
        fill="currentColor"
      />
    </svg>
  )
}
