import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'
import { entityColor } from '../model/flow'
import type { NodeKind } from '../model/types'
import { enterSubprocess } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { NODE_SIZE } from './geometry'

export interface NodeData extends Record<string, unknown> {
  questions: number
  /** Haun tai suodattimen ulkopuolinen vaihe himmennetään. */
  dim: boolean
}

function InlineEdit({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const label = value.trim()
    if (commit && label && label !== initial) {
      useStore
        .getState()
        .dispatch({ type: 'updateNode', id, patch: { label } }, { coalesceKey: `label:${id}` })
    }
    useUi.getState().setEditNode(null)
  }
  return (
    <input
      ref={ref}
      className="node__edit nodrag nopan"
      value={value}
      aria-label="Vaiheen nimi"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

function ProcessNodeViewImpl({ id, selected, data }: NodeProps) {
  const node = useStore((s) => s.project?.nodes[id])
  const role = useStore((s) => (node?.roleId ? s.project?.entities[node.roleId] : undefined))
  const systems = useStore((s) => s.project?.entities)
  // Avointen kysymysten määrä tulee kaaviolta (lasketaan kerran koko kaaviolle, ei solmukohtaisesti).
  const openQuestions = (data as NodeData).questions
  const vertical = useUi((s) => s.layoutMode !== 'lanes' && s.direction === 'DOWN')
  const editing = useUi((s) => s.editNodeId === id)
  if (!node) return null
  const kind: NodeKind = node.kind
  const size = NODE_SIZE[kind]
  const sysNames = node.systemIds.map((x) => systems?.[x]?.name).filter(Boolean) as string[]

  const label = editing ? (
    <InlineEdit id={id} initial={node.label} />
  ) : (
    <span className="node__label" title={node.label}>
      {node.label || <em>Nimetön</em>}
    </span>
  )

  return (
    <div
      className={`node node--${kind} ${selected ? 'is-selected' : ''} ${(data as NodeData).dim ? 'is-dim' : ''}`}
      data-confidence={node.confidence}
      data-testid={`node-${kind}`}
      style={{ width: size.width, height: size.height }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (kind === 'subprocess') enterSubprocess(id)
        else useUi.getState().setEditNode(id)
      }}
    >
      {kind !== 'start' && (
        <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      )}
      {kind !== 'end' && (
        <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
      )}

      {kind === 'decision' && (
        <svg
          className="node__shape"
          viewBox="0 0 190 104"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points="95,2 188,52 95,102 2,52" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {kind === 'step' || kind === 'subprocess' ? (
        <>
          {role && <span className="node__role-bar" style={{ background: entityColor(role.id) }} />}
          <div className="node__body">
            {label}
            <div className="node__meta">
              {role && <span className="node__role">{role.name}</span>}
              {sysNames.length > 0 && (
                <span className="node__sys">
                  {sysNames.slice(0, 2).join(', ')}
                  {sysNames.length > 2 ? ` +${sysNames.length - 2}` : ''}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="node__body node__body--center">{label}</div>
      )}

      {kind === 'subprocess' && (
        <button
          type="button"
          className="node__enter nodrag nopan"
          aria-label={`Avaa alaprosessi ${node.label}`}
          title="Avaa alaprosessi"
          onClick={(e) => {
            e.stopPropagation()
            enterSubprocess(id)
          }}
        >
          <Icon name="enter" size={14} />
        </button>
      )}
      {node.locked && (
        <span className="node__badge node__badge--lock" title="Sijainti lukittu">
          <Icon name="lock" size={11} />
        </span>
      )}
      {openQuestions > 0 && (
        <button
          type="button"
          className="node__badge node__badge--q nodrag nopan"
          title={`${openQuestions} avointa kysymystä. Avaa kysymykset.`}
          aria-label={`${openQuestions} avointa kysymystä: ${node.label}`}
          onClick={(e) => {
            e.stopPropagation()
            useStore.getState().select({ nodeIds: [id], edgeIds: [] })
            useUi.getState().showRight('questions')
          }}
        >
          {openQuestions}
        </button>
      )}
    </div>
  )
}

export const ProcessNodeView = memo(ProcessNodeViewImpl)
