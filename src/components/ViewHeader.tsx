import { ArrowLeft, ArrowRight, BookOpen, ChevronsDownUp, ChevronsUpDown, Code, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Note } from '@/lib/types'
import { useNotes } from '@/store/notes'
import { useUi } from '@/store/ui'
import { ClickableIcon, useMenu } from './ui'

/**
 * Obsidian's view header: back/forward, the note's breadcrumb, and view actions
 * (Live Preview ⇄ Source mode, more options).
 */
export function ViewHeader({
  note,
  livePreview,
  onToggleMode,
  onFoldAll,
  onUnfoldAll,
}: {
  note: Note
  livePreview: boolean
  onToggleMode: () => void
  onFoldAll: () => void
  onUnfoldAll: () => void
}) {
  const folders = useNotes((s) => s.folders)
  const deleteNote = useNotes((s) => s.deleteNote)
  const canBack = useUi((s) => s.historyIndex > 0)
  const canForward = useUi((s) => s.historyIndex < s.history.length - 1)
  const { goBack, goForward } = useUi.getState()
  const menu = useMenu()

  const crumbs: string[] = []
  for (let id = note.folderId; id; ) {
    const f = folders.find((x) => x.id === id)
    if (!f) break
    crumbs.unshift(f.name)
    id = f.parentId
  }

  return (
    <div className="flex h-(--header-height) shrink-0 items-center gap-1 px-2">
      <ClickableIcon icon={ArrowLeft} label="Navigate back" size={16} onClick={goBack} className={canBack ? '' : 'opacity-40'} />
      <ClickableIcon
        icon={ArrowRight}
        label="Navigate forward"
        size={16}
        onClick={goForward}
        className={canForward ? '' : 'opacity-40'}
      />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 text-[13px]" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1 text-(--text-faint)">
            <span className="truncate">{c}</span>
            <span>/</span>
          </span>
        ))}
        <span className="truncate text-(--text-normal)">{note.title.trim() || 'Untitled'}</span>
      </div>
      <ClickableIcon
        icon={livePreview ? BookOpen : Code}
        label={livePreview ? 'Live Preview — click for Source mode' : 'Source mode — click for Live Preview'}
        size={16}
        onClick={onToggleMode}
      />
      <ClickableIcon
        icon={MoreHorizontal}
        label="More options"
        size={16}
        onClick={(e) =>
          menu.open(e, [
            { label: livePreview ? 'Source mode' : 'Live Preview', icon: livePreview ? Code : BookOpen, onSelect: onToggleMode },
            'separator',
            { label: 'Fold all headings and lists', icon: ChevronsDownUp, onSelect: onFoldAll },
            { label: 'Unfold all headings and lists', icon: ChevronsUpDown, onSelect: onUnfoldAll },
            'separator',
            {
              label: 'Delete file',
              icon: Trash2,
              danger: true,
              onSelect: () => {
                if (window.confirm(`Delete "${note.title.trim() || 'Untitled'}"? This can't be undone.`)) deleteNote(note.id)
              },
            },
          ])
        }
      />
      {menu.element}
    </div>
  )
}
