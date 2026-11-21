import {
  SCHEMA_VERSION,
  type Project,
  type ProcessCard,
  type SavedView,
  type Scenario,
  type Version,
} from './types'
import { validateProject } from './validate'

export const FILE_APP_ID = 'prosessikartta'

export interface ProjectFile {
  app: typeof FILE_APP_ID
  schemaVersion: number
  exportedAt: number
  project: Project
}

/**
 * Migraatiot: `MIGRATIONS[n]` päivittää skeemaversion n -> n+1. Lisää uusi funktio aina kun
 * tallennettava muoto muuttuu, ja kasvata SCHEMA_VERSIONia.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: tietotyön kentät (RACI, kesto, odotus, kipupisteet, tunnisteet) ovat valinnaisia, joten data säilyy sellaisenaan.
  1: (raw) => raw,
  // v2 -> v3: versiot (valinnainen kenttä).
  2: (raw) => raw,
  // v3 -> v4: skenaariot ja tallennetut näkymät (valinnaisia kenttiä).
  3: (raw) => raw,
  // v4 -> v5: prosessikortti, roolien kuvaus ja vaiheen tarkistuslista (valinnaisia kenttiä).
  4: (raw) => raw,
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new ImportError('Tiedosto ei sisällä projektia')
  let cur = raw as Record<string, unknown>
  let version = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 1
  if (version > SCHEMA_VERSION) {
    throw new ImportError(
      `Tiedosto on uudemmasta versiosta (${version}) kuin tämä sovellus (${SCHEMA_VERSION}). Päivitä sovellus.`,
    )
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new ImportError(`Ei migraatiota versiosta ${version}`)
    cur = step(cur)
    version++
    cur.schemaVersion = version
  }
  return normalizeProject(cur)
}

const CARD_TEXT = ['purpose', 'owner', 'trigger', 'customer'] as const
const CARD_LISTS = ['outputs', 'metrics', 'risks', 'checklist'] as const

/** Poistaa prosessikortista virheelliset kentät. Palauttaa undefined, jos kortti jää tyhjäksi. */
export function sanitizeCard(raw: unknown): ProcessCard | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const card: ProcessCard = {}
  for (const k of CARD_TEXT) {
    const v = src[k]
    if (typeof v === 'string' && v.trim()) card[k] = v.trim()
  }
  for (const k of CARD_LISTS) {
    const v = src[k]
    if (Array.isArray(v)) {
      const list = v
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => x.trim())
      if (list.length) card[k] = list
    }
  }
  return Object.keys(card).length ? card : undefined
}

const RECORDS = ['processes', 'nodes', 'edges', 'entities', 'sources', 'questions'] as const

/** Täydentää puuttuvat kentät, jotta vajaa tai käsin muokattu tiedosto ei kaada sovellusta. */
function normalizeProject(raw: Record<string, unknown>): Project {
  for (const key of RECORDS) {
    const v = raw[key]
    if (v === undefined) raw[key] = {}
    else if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new ImportError(`Kenttä "${key}" on virheellinen`)
    }
  }
  if (typeof raw.id !== 'string' || typeof raw.rootProcessId !== 'string') {
    throw new ImportError('Projektin tunniste tai päätason prosessi puuttuu')
  }
  const p = raw as unknown as Project
  p.name = typeof p.name === 'string' ? p.name : 'Nimetön projekti'
  p.createdAt = typeof p.createdAt === 'number' ? p.createdAt : Date.now()
  p.updatedAt = typeof p.updatedAt === 'number' ? p.updatedAt : p.createdAt
  for (const n of Object.values(p.nodes)) {
    n.systemIds ??= []
    n.inputIds ??= []
    n.outputIds ??= []
    n.sources ??= []
    n.confidence ??= 'likely'
    n.kind ??= 'step'
    n.label ??= ''
  }
  for (const e of Object.values(p.entities)) {
    e.aliases ??= []
    if (typeof e.description !== 'string') delete e.description
  }
  for (const n of Object.values(p.nodes)) {
    if (n.checklist !== undefined) {
      n.checklist = Array.isArray(n.checklist)
        ? n.checklist.filter((x) => typeof x === 'string' && x.trim())
        : undefined
      if (!n.checklist?.length) delete n.checklist
    }
  }
  for (const proc of Object.values(p.processes)) {
    if (proc.card !== undefined) {
      const card = sanitizeCard(proc.card)
      if (card) proc.card = card
      else delete proc.card
    }
  }
  // Skenaariot ja näkymät: viallinen tietue pudotetaan, jottei se estä projektin avaamista.
  if (p.scenarios !== undefined) {
    const ok: NonNullable<Project['scenarios']> = {}
    const raw = p.scenarios as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, sc] of Object.entries(raw as Record<string, Scenario>)) {
        if (
          sc &&
          typeof sc.name === 'string' &&
          typeof sc.processId === 'string' &&
          sc.choices &&
          typeof sc.choices === 'object'
        )
          ok[id] = sc
      }
    }
    p.scenarios = Object.keys(ok).length ? ok : undefined
  }
  if (p.views !== undefined) {
    p.views = Array.isArray(p.views)
      ? (p.views as SavedView[]).filter(
          (v) =>
            v &&
            typeof v.id === 'string' &&
            typeof v.name === 'string' &&
            typeof v.processId === 'string',
        )
      : undefined
    if (p.views && p.views.length === 0) p.views = undefined
  }
  // Vioittunut versio ei saa estää projektin avaamista: se pudotetaan.
  if (p.versions !== undefined) {
    const ok: NonNullable<Project['versions']> = {}
    const v = p.versions as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [id, ver] of Object.entries(v as Record<string, Version>)) {
        const s = ver?.snapshot
        if (
          ver &&
          typeof ver.name === 'string' &&
          s &&
          typeof s.rootProcessId === 'string' &&
          s.processes &&
          s.nodes &&
          s.edges &&
          s.entities &&
          s.processes[s.rootProcessId]
        ) {
          ok[id] = { ...ver, kind: ver.kind === 'baseline' ? 'baseline' : 'manual' }
        }
      }
    }
    p.versions = Object.keys(ok).length ? ok : undefined
  }
  for (const key of ['stamps', 'tombstones'] as const) {
    const raw = p[key] as unknown
    if (raw === undefined) continue
    const ok: Record<string, number> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [id, t] of Object.entries(raw as Record<string, unknown>))
        if (typeof t === 'number' && Number.isFinite(t)) ok[id] = t
    if (Object.keys(ok).length) p[key] = ok
    else delete p[key]
  }
  const issues = validateProject(p)
  if (issues.length) {
    throw new ImportError(
      `Projekti on vioittunut: ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1} muuta)` : ''}`,
    )
  }
  return p
}

export function exportProjectFile(p: Project): ProjectFile {
  return { app: FILE_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), project: p }
}

export function projectToJson(p: Project): string {
  return JSON.stringify(exportProjectFile(p), null, 2)
}

export function parseProjectJson(text: string): Project {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('Tiedosto ei ole kelvollista JSONia')
  }
  if (!data || typeof data !== 'object') throw new ImportError('Tiedosto ei ole projektitiedosto')
  const file = data as Partial<ProjectFile>
  if (file.app !== FILE_APP_ID || !file.project)
    throw new ImportError('Tiedosto ei ole Prosessikartan projektitiedosto')
  // Tiedoston skeemaversio ohjaa migraatiota.
  const raw = { ...(file.project as unknown as Record<string, unknown>) }
  if (typeof file.schemaVersion === 'number') raw.schemaVersion = file.schemaVersion
  return migrateProject(raw)
}
