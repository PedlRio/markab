import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Obsidian's `clickable-icon`: a square, borderless icon button. */
export function ClickableIcon({
  icon: Icon,
  label,
  onClick,
  active,
  size = 18,
  className = '',
}: {
  icon: LucideIcon
  label: string
  onClick: (e: React.MouseEvent) => void
  active?: boolean
  size?: number
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center rounded-(--radius-s,4px) p-1.5 transition-colors hover:bg-(--background-modifier-hover) hover:text-(--icon-color-hover) ${
        active ? 'bg-(--background-modifier-hover) text-(--icon-color-hover)' : 'text-(--icon-color)'
      } ${className}`}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  )
}

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  danger?: boolean
}

export type MenuEntry = MenuItem | 'separator'

/** A right-click / "more options" menu, positioned at the pointer and kept on screen. */
export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="mk-theme fixed z-100 min-w-48 rounded-lg border border-(--background-modifier-border) bg-(--background-secondary) p-1 text-[13px] shadow-(--shadow-l)"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="mx-1 my-1 h-px bg-(--background-modifier-border)" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-(--background-modifier-hover) ${
              item.danger ? 'text-(--color-red)' : 'text-(--text-normal)'
            }`}
          >
            {item.icon && <item.icon size={15} strokeWidth={1.75} className="shrink-0 opacity-80" />}
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

/** Holds menu state for a component: `open(e, items)` from a contextmenu/click handler. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const open = (e: React.MouseEvent, items: MenuEntry[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const element: ReactNode = menu ? (
    <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
  ) : null
  return { open, element }
}

/** Obsidian-style centred modal. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="mk-theme fixed inset-0 z-90 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={title}
        className="relative max-h-[80vh] w-[min(640px,92vw)] overflow-y-auto rounded-xl border border-(--background-modifier-border) bg-(--modal-background) p-6 text-(--text-normal) shadow-(--shadow-l)"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-(--text-muted) hover:bg-(--background-modifier-hover) hover:text-(--text-normal)"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** One row of an Obsidian settings page: name + description on the left, control on the right. */
export function SettingItem({
  name,
  description,
  children,
}: {
  name: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-(--background-modifier-border) py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm text-(--text-normal)">{name}</div>
        {description && <div className="mt-0.5 text-xs text-(--text-muted)">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-(--interactive-accent)' : 'bg-(--background-modifier-border)'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${
          checked ? 'left-4.5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-(--background-modifier-form-field) p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            value === o.id ? 'bg-(--background-primary) text-(--text-normal) shadow-sm' : 'text-(--text-muted) hover:text-(--text-normal)'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
