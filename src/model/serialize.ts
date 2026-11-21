import { SCHEMA_VERSION, type Project, type Version } from './types'
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
  for (const e of Object.values(p.entities)) e.aliases ??= []
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
