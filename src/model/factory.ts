import { newId } from './ids'
import {
  SCHEMA_VERSION,
  type Entity,
  type EntityKind,
  type Process,
  type ProcessEdge,
  type ProcessNode,
  type Project,
} from './types'

export function createNode(
  processId: string,
  init: Partial<ProcessNode> & Pick<ProcessNode, 'label'>,
): ProcessNode {
  return {
    id: newId('n'),
    processId,
    kind: 'step',
    systemIds: [],
    inputIds: [],
    outputIds: [],
    confidence: 'likely',
    sources: [],
    ...init,
  }
}

export function createEdge(
  processId: string,
  from: string,
  to: string,
  label?: string,
): ProcessEdge {
  return { id: newId('e'), processId, from, to, ...(label ? { label } : {}) }
}

export function createEntity(kind: EntityKind, name: string, aliases: string[] = []): Entity {
  return { id: newId('ent'), kind, name, aliases }
}

export function createProcess(name: string, parentNodeId?: string): Process {
  return { id: newId('p'), name, ...(parentNodeId ? { parentNodeId } : {}) }
}

export function createProject(name = 'Uusi projekti', rootName = 'Päätason prosessi'): Project {
  const root = createProcess(rootName)
  const now = Date.now()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    rootProcessId: root.id,
    processes: { [root.id]: root },
    nodes: {},
    edges: {},
    entities: {},
    sources: {},
    questions: {},
  }
}
