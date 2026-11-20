import { memo, useMemo, useRef } from 'react'
import { buildSegments, trimRange, type Mark } from '../capture/segments'

interface Props {
  text: string
  marks: Mark[]
  onSelect: (range: { start: number; end: number } | null) => void
  onClickNodes: (nodeIds: string[]) => void
  onClickSuggestion: (id: string) => void
}

const CLASS: Record<Mark['type'], string> = {
  ref: 'm-ref',
  role: 'm-role',
  system: 'm-system',
  artifact: 'm-artifact',
  suggestion: 'm-sug',
  selection: 'm-sel',
  focus: 'm-focus',
}

/** Valinnan sijainti tekstin merkkeinä. Toimii, koska näytetty teksti vastaa lähdetekstiä merkki merkiltä. */
function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  if (!container.contains(r.commonAncestorContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(container)
  pre.setEnd(r.startContainer, r.startOffset)
  const start = pre.toString().length
  return { start, end: start + r.toString().length }
}

function SourceReaderImpl({ text, marks, onSelect, onClickNodes, onClickSuggestion }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const segments = useMemo(() => buildSegments(text, marks), [text, marks])

  const handleSelection = () => {
    const el = ref.current
    if (!el) return
    const raw = selectionOffsets(el)
    onSelect(raw ? trimRange(text, raw.start, raw.end) : null)
  }

  return (
    <div
      ref={ref}
      className="reader"
      data-testid="reader"
      tabIndex={0}
      aria-label="Lähdeteksti"
      onMouseUp={handleSelection}
      onKeyUp={(e) => {
        if (e.shiftKey || e.key.startsWith('Arrow')) handleSelection()
      }}
      onClick={(e) => {
        if (!window.getSelection()?.isCollapsed) return
        const target = e.target as HTMLElement
        const nodes = target.closest<HTMLElement>('[data-nodes]')?.dataset.nodes
        if (nodes) return onClickNodes(nodes.split(','))
        const sug = target.closest<HTMLElement>('[data-sug]')?.dataset.sug
        if (sug) onClickSuggestion(sug)
        else onSelect(null)
      }}
    >
      {segments.map((seg) => {
        if (seg.marks.length === 0)
          return (
            <span key={seg.start} data-start={seg.start}>
              {seg.text}
            </span>
          )
        const cls = seg.marks.map((m) => CLASS[m.type]).join(' ')
        const nodeIds = seg.marks.filter((m) => m.type === 'ref').flatMap((m) => m.nodeIds ?? [])
        const sug = seg.marks.find((m) => m.type === 'suggestion')?.suggestionId
        return (
          <span
            key={seg.start}
            data-start={seg.start}
            className={cls}
            data-nodes={nodeIds.length ? [...new Set(nodeIds)].join(',') : undefined}
            data-sug={sug}
          >
            {seg.text}
          </span>
        )
      })}
    </div>
  )
}

export const SourceReader = memo(SourceReaderImpl)
