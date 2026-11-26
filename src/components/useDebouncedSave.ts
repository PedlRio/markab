import { useCallback, useEffect, useRef } from 'react'

const SAVE_DELAY_MS = 400

/**
 * Debounced save that can be flushed. Flushing on unmount and when the tab is hidden or
 * closed means the last keystrokes are never lost.
 */
export function useDebouncedSave(save: (value: string) => void) {
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current !== null) {
      const value = pending.current
      pending.current = null
      saveRef.current(value)
    }
  }, [])

  const schedule = useCallback(
    (value: string) => {
      pending.current = value
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  return schedule
}
