import type { NodeKind } from '../model/types'

export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  start: { width: 120, height: 44 },
  end: { width: 120, height: 44 },
  step: { width: 200, height: 72 },
  subprocess: { width: 200, height: 72 },
  decision: { width: 190, height: 104 },
}
