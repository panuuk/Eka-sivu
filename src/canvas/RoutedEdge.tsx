import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { Point } from '../model/types'
import { labelPoint, roundedPath } from './routes'

export interface RoutedEdgeData extends Record<string, unknown> {
  points?: Point[]
}

/** Reuna, joka käyttää ELK:n laskemaa reittiä. Ilman reittiä (esim. käsin siirretty solmu) käytetään oletusreititystä. */
export function RoutedEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    label,
    interactionWidth,
  } = props
  const points = (props.data as RoutedEdgeData | undefined)?.points
  let path: string
  let lx: number
  let ly: number
  if (points && points.length >= 2) {
    path = roundedPath(points, 10)
    const lp = labelPoint(points)
    lx = lp.x
    ly = lp.y
  } else {
    ;[path, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 10,
    })
  }
  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={lx}
      labelY={ly}
      label={label}
      labelShowBg
      labelBgPadding={[5, 3]}
      labelBgBorderRadius={5}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  )
}
