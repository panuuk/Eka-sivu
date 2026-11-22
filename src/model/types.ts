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

/** Arvio minuutteina: vähintään, tyypillinen ja enintään. Työpäivä = 480 min, viikko = 5 työpäivää. */
export interface DurationRange {
  min?: number
  typical?: number
  max?: number
}

export type PainSeverity = 1 | 2 | 3

/** Kipupiste: vaiheen ongelma ja mahdollinen parannusidea. */
export interface PainPoint {
  id: string
  text: string
  severity: PainSeverity
  idea?: string
}

/** RACI: rooli (`roleId`) on vastuullinen suorittaja (R). Muut roolit tallennetaan tähän. */
interface Raci {
  accountableIds?: string[]
  consultedIds?: string[]
  informedIds?: string[]
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
  /** Muut RACI-roolit kuin suorittaja. */
  raci?: Raci
  /** Vaiheen työaika. */
  duration?: DurationRange
  /** Odotusaika ennen vaihetta (jonotus, vastausta odottaminen). */
  waiting?: DurationRange
  /** Toistuvuus vapaana tekstinä: "päivittäin", "viikoittain", "tapahtumapohjainen". */
  frequency?: string
  painPoints?: PainPoint[]
  tags?: string[]
  /** Tarkistuslista: asiat, jotka on varmistettava vaiheen yhteydessä. */
  checklist?: string[]
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
  /** Vapaa kuvaus, esim. roolin keskeinen vastuu. */
  description?: string
}

/** Prosessikortti: prosessin tarkoitus, omistaja ja rajat yhdellä silmäyksellä. */
export interface ProcessCard {
  purpose?: string
  owner?: string
  trigger?: string
  customer?: string
  outputs?: string[]
  metrics?: string[]
  risks?: string[]
  /** Koko prosessin tarkistuslista (laatukriteerit). */
  checklist?: string[]
}

export interface Process {
  id: string
  name: string
  description?: string
  card?: ProcessCard
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

type QuestionStatus = 'open' | 'answered' | 'dismissed'

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

type HeatKind = 'off' | 'time' | 'pain' | 'handoff'

/**
 * Skenaariopolku: valinnat päätöksissä ("luottoraja ylittyy"). Polku kulkee alusta loppuun
 * valittuja haaroja pitkin; valitsemattomissa päätöksissä seurataan ensimmäistä haaraa.
 */
export interface Scenario {
  id: string
  name: string
  description?: string
  processId: string
  /** Päätössolmun tunniste -> valittu lähtevä yhteys. */
  choices: Record<string, string>
}

/** Tallennettu näkymä: rajaus, asettelu ja korostukset, joista esitys ja PowerPoint koostetaan. */
export interface SavedView {
  id: string
  name: string
  /** Puhujan muistiinpano ja dian kuvaus. */
  note?: string
  processId: string
  expand: boolean
  onlyConfirmed: boolean
  showMetrics: boolean
  heat: HeatKind
  changes: boolean
  /** Korostettava skenaariopolku. */
  scenarioId?: string
  /** Rajaa kuvan näihin vaiheisiin (ja niiden ympäristöön). */
  focusNodeIds?: string[]
}

/** Prosessin rakenne ilman lähteitä, kysymyksiä ja versioita: sitä verrataan ja se voidaan palauttaa. */
export interface ProjectSnapshot {
  rootProcessId: string
  processes: Record<string, Process>
  nodes: Record<string, ProcessNode>
  edges: Record<string, ProcessEdge>
  entities: Record<string, Entity>
}

/** Nimetty versio: projektin tila tiettynä hetkenä. `baseline` on tavoitetilaprojektin lähtötilanne. */
export interface Version {
  id: string
  name: string
  comment?: string
  createdAt: number
  kind: 'manual' | 'baseline'
  snapshot: ProjectSnapshot
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
  /** Nimetyt versiot (valinnainen). Ne kulkevat projektin mukana vienneissä ja varmuuskopioissa. */
  versions?: Record<string, Version>
  scenarios?: Record<string, Scenario>
  /** Tallennetut näkymät esityksen järjestyksessä. */
  views?: SavedView[]
  /** Viimeisin muokkausaika tietueen tunnisteen mukaan (laitteiden välistä yhdistämistä varten). */
  stamps?: Record<string, number>
  /** Poistettujen tietueiden poistoaika tunnisteen mukaan. */
  tombstones?: Record<string, number>
}

export const SCHEMA_VERSION = 5

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
