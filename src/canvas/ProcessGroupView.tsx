import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { entityColor } from '../model/flow'
import { enterSubprocess } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import type { NodeData } from './ProcessNodeView'

/** Kokonaiskuvassa avattu alaprosessi: laatikko, jonka sisällä alaprosessin vaiheet näkyvät. */
function ProcessGroupViewImpl({ id, selected, data, width, height }: NodeProps) {
  const node = useStore((s) => s.project?.nodes[id])
  const role = useStore((s) => (node?.roleId ? s.project?.entities[node.roleId] : undefined))
  const vertical = useUi((s) => s.layoutMode !== 'lanes' && s.direction === 'DOWN')
  if (!node) return null
  return (
    <div
      className={`group-box ${selected ? 'is-selected' : ''} ${(data as NodeData).dim ? 'is-dim' : ''}`}
      style={{ width, height }}
      data-testid="group-box"
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
      <div className="group-box__head">
        {role && <span className="group-box__dot" style={{ background: entityColor(role.id) }} />}
        <span className="group-box__title" title={node.label}>
          {node.label}
        </span>
        <span className="group-box__kind">alaprosessi</span>
        <button
          type="button"
          className="icon-btn nodrag nopan"
          aria-label={`Avaa alaprosessi ${node.label}`}
          title="Avaa alaprosessi"
          onClick={(e) => {
            e.stopPropagation()
            enterSubprocess(id)
          }}
        >
          <Icon name="enter" size={14} />
        </button>
      </div>
    </div>
  )
}

export const ProcessGroupView = memo(ProcessGroupViewImpl)
