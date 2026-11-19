import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'

export interface LaneData extends Record<string, unknown> {
  name: string
  color: string
  /** Rata, jolla on vaiheita ilman roolia. */
  missing: boolean
}

/** Uimarata: vaakasuuntainen kaista, jonka vasemmassa reunassa on roolin nimi. */
function LaneViewImpl({ data, width, height }: NodeProps) {
  const d = data as LaneData
  return (
    <div
      className={`lane ${d.missing ? 'lane--missing' : ''}`}
      style={{ width, height, ['--lane' as string]: d.color }}
      data-testid="lane"
    >
      <div className="lane__label">
        <span className="lane__dot" />
        <span>{d.name}</span>
      </div>
    </div>
  )
}

export const LaneView = memo(LaneViewImpl)
