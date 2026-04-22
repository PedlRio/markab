import { Image as BaseImage } from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState, useRef, useCallback } from 'react'

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as { src: string; alt?: string; title?: string; width?: number }
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const startX = e.clientX
      const startW = containerRef.current?.offsetWidth ?? attrs.width ?? 400
      setIsResizing(true)

      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(80, Math.min(startW + (ev.clientX - startX), 900))
        updateAttributes({ width: Math.round(newW) })
      }
      const onUp = () => {
        setIsResizing(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [attrs.width, updateAttributes],
  )

  return (
    <NodeViewWrapper className="my-4">
      <div
        ref={containerRef}
        className={`relative inline-block max-w-full ${isResizing ? 'select-none cursor-se-resize' : ''}`}
        style={{ width: attrs.width ? `${attrs.width}px` : 'auto' }}
      >
        {/* Selection ring */}
        {selected && (
          <div className="absolute inset-0 ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950 rounded pointer-events-none z-10" />
        )}

        <img
          src={attrs.src}
          alt={attrs.alt ?? ''}
          title={attrs.title}
          className="block max-w-full h-auto rounded"
          draggable={false}
          style={{ width: '100%' }}
        />

        {selected && (
          <>
            {/* Bottom-right resize handle */}
            <div
              onMouseDown={startResize}
              className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-blue-500 border-2 border-zinc-950 rounded-sm cursor-se-resize translate-x-1/2 translate-y-1/2 z-20 hover:bg-blue-400 transition-colors"
            />
            {/* Bottom-left resize handle */}
            <div
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const startX = e.clientX
                const startW = containerRef.current?.offsetWidth ?? attrs.width ?? 400
                setIsResizing(true)
                const onMove = (ev: MouseEvent) => {
                  const newW = Math.max(80, Math.min(startW - (ev.clientX - startX), 900))
                  updateAttributes({ width: Math.round(newW) })
                }
                const onUp = () => {
                  setIsResizing(false)
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
              className="absolute bottom-0 left-0 w-3.5 h-3.5 bg-blue-500 border-2 border-zinc-950 rounded-sm cursor-sw-resize -translate-x-1/2 translate-y-1/2 z-20 hover:bg-blue-400 transition-colors"
            />

            {/* Width badge */}
            {attrs.width && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-xs bg-zinc-900 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700 whitespace-nowrap font-mono pointer-events-none">
                {attrs.width}px
              </div>
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const ResizableImage = BaseImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('width')
          return w ? Number(w) : null
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {}
          return {
            width: String(attrs.width as number),
            style: `width: ${attrs.width}px; max-width: 100%`,
          }
        },
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
