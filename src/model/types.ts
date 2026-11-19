/** Datamalli: prosessi on rakenteinen graafi, jonka näkymät (kaavio, lista, esitys) piirretään mallista. */

export type Confidence = 'guess' | 'likely' | 'confirmed'
export type NodeKind = 'start' | 'end' | 'step' | 'decision' | 'subprocess'
export type EntityKind = 'role' | 'system' | 'artifact'

export interface SourceRef {
  sourceId: string
  start: number
  end: number
  /** Lainattu teksti talteen siltä varalta, että lähde muuttuu. */
  quote: string
}

export interface Point {
  x: number
  y: number
}

export interface ProcessNode {
  id: string
  processId: string
  kind: NodeKind
  label: string
  description?: string
  roleId?: string
  systemIds: string[]
  inputIds: string[]
  outputIds: string[]
  /** Alaprosessi, jos vaihe on avattu omaksi prosessikseen. */
  childProcessId?: string
  confidence: Confidence
  sources: SourceRef[]
  notes?: string
  /** Käsin asetettu sijainti. Käytössä vain, kun `locked` on tosi. */
  position?: Point
  locked?: boolean
}

export interface ProcessEdge {
  id: string
  processId: string
  from: string
  to: string
  label?: string
}

export interface Entity {
  id: string
  kind: EntityKind
  name: string
  /** Vaihtoehtoiset nimet ja taivutusmuodot, jotka auttavat tunnistamaan entiteetin teksteistä. */
  aliases: string[]
}

export interface Process {
  id: string
  name: string
  description?: string
  /** Vaihe, josta tämä prosessi on avattu alaprosessiksi. Puuttuu päätason prosesseilta. */
  parentNodeId?: string
}

export interface Source {
  id: string
  title: string
  kind: 'note' | 'document'
  text: string
  addedAt: number
  /** Tuodun tiedoston alkuperäinen nimi. */
  fileName?: string
}

export type QuestionStatus = 'open' | 'answered' | 'dismissed'

export interface Question {
  id: string
  processId: string
  /** Solmu, johon kysymys liittyy. Puuttuu prosessitason kysymyksiltä. */
  targetId?: string
  /** Aukkosäännön tunniste tai 'custom' käyttäjän omille kysymyksille. */
  rule: string
  text: string
  status: QuestionStatus
  answer?: string
  /** Vakaa avain, jolla generoidut kysymykset tunnistetaan uudelleen ajojen välillä. */
  key: string
}

export interface Project {
  schemaVersion: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  rootProcessId: string
  processes: Record<string, Process>
  nodes: Record<string, ProcessNode>
  edges: Record<string, ProcessEdge>
  entities: Record<string, Entity>
  sources: Record<string, Source>
  questions: Record<string, Question>
}

export const SCHEMA_VERSION = 1

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  guess: 'Arvaus',
  likely: 'Todennäköinen',
  confirmed: 'Vahvistettu',
}

export const KIND_LABELS: Record<NodeKind, string> = {
  start: 'Alku',
  end: 'Loppu',
  step: 'Vaihe',
  decision: 'Päätös',
  subprocess: 'Alaprosessi',
}

export const ENTITY_LABELS: Record<EntityKind, string> = {
  role: 'Rooli',
  system: 'Järjestelmä',
  artifact: 'Syöte/tuotos',
}
