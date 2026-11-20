import Dexie, { type EntityTable } from 'dexie'
import { migrateProject } from '../model/serialize'
import type { Project } from '../model/types'

interface ProjectRow {
  id: string
  name: string
  updatedAt: number
  data: Project
}

class AppDb extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>
  meta!: EntityTable<{ key: string; value: string }, 'key'>

  constructor(name = 'prosessikartta') {
    super(name)
    this.version(1).stores({ projects: 'id, updatedAt', meta: 'key' })
  }
}

let db = new AppDb()

/** Vain testejä varten: vaihda tietokanta tuoreeseen. */
export function resetDbForTests(name: string) {
  db = new AppDb(name)
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await db.projects.orderBy('updatedAt').reverse().toArray()
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }))
}

export async function saveProject(p: Project): Promise<void> {
  await db.projects.put({ id: p.id, name: p.name, updatedAt: p.updatedAt, data: p })
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const row = await db.projects.get(id)
  if (!row) return undefined
  // Kulje data migraation läpi, jotta vanhat tallenteet päivittyvät.
  return migrateProject(structuredClone(row.data))
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id)
}

const ACTIVE_KEY = 'activeProject'
export async function getActiveProjectId(): Promise<string | undefined> {
  return (await db.meta.get(ACTIVE_KEY))?.value
}
export async function setActiveProjectId(id: string): Promise<void> {
  await db.meta.put({ key: ACTIVE_KEY, value: id })
}

/** Pyytää selainta suojaamaan tallennuksen automaattiselta siivoukselta. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
