import Dexie, { type EntityTable } from 'dexie'
import { newId } from '../model/ids'
import { migrateProject } from '../model/serialize'
import type { Project } from '../model/types'

interface ProjectRow {
  id: string
  name: string
  updatedAt: number
  data: Project
}

/** Varmuuskopion kuvaus. Itse projekti on omassa taulussaan, jotta luettelo latautuu nopeasti. */
export interface BackupMeta {
  id: string
  projectId: string
  projectName: string
  /** Varmuuskopion ottohetki. */
  createdAt: number
  /** Projektin muokkausaika kopiota otettaessa. */
  projectUpdatedAt: number
  reason: BackupReason
  nodeCount: number
}

export type BackupReason = 'auto' | 'manual' | 'before-restore' | 'deleted'

interface BackupDataRow {
  id: string
  data: Project
}

/** Projektiin yhdistetty levytiedosto (File System Access API). */
interface FileLinkRow {
  projectId: string
  handle: unknown
  fileName: string
  lastWriteAt?: number
}

class AppDb extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>
  meta!: EntityTable<{ key: string; value: string }, 'key'>
  backups!: EntityTable<BackupMeta, 'id'>
  backupData!: EntityTable<BackupDataRow, 'id'>
  fileLinks!: EntityTable<FileLinkRow, 'projectId'>

  constructor(name = 'prosessikartta') {
    super(name)
    this.version(1).stores({ projects: 'id, updatedAt', meta: 'key' })
    this.version(2).stores({
      projects: 'id, updatedAt',
      meta: 'key',
      backups: 'id, projectId, createdAt',
      backupData: 'id',
      fileLinks: 'projectId',
    })
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

/** Lisää varmuuskopion ja palauttaa sen kuvauksen. */
export async function addBackup(project: Project, reason: BackupReason): Promise<BackupMeta> {
  const meta: BackupMeta = {
    id: newId('bak'),
    projectId: project.id,
    projectName: project.name,
    createdAt: Date.now(),
    projectUpdatedAt: project.updatedAt,
    reason,
    nodeCount: Object.keys(project.nodes).length,
  }
  await db.transaction('rw', db.backups, db.backupData, async () => {
    await db.backups.put(meta)
    await db.backupData.put({ id: meta.id, data: structuredClone(project) })
  })
  return meta
}

/** Varmuuskopiot uusimmasta vanhimpaan. Ilman tunnistetta kaikkien projektien kopiot. */
export async function listBackups(projectId?: string): Promise<BackupMeta[]> {
  const all = projectId
    ? await db.backups.where('projectId').equals(projectId).toArray()
    : await db.backups.toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function loadBackup(id: string): Promise<Project | undefined> {
  const row = await db.backupData.get(id)
  return row ? migrateProject(structuredClone(row.data)) : undefined
}

export async function deleteBackups(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db.transaction('rw', db.backups, db.backupData, async () => {
    await db.backups.bulkDelete(ids)
    await db.backupData.bulkDelete(ids)
  })
}

export async function getFileLink(projectId: string): Promise<FileLinkRow | undefined> {
  return db.fileLinks.get(projectId)
}
export async function putFileLink(row: FileLinkRow): Promise<void> {
  await db.fileLinks.put(row)
}
export async function deleteFileLink(projectId: string): Promise<void> {
  await db.fileLinks.delete(projectId)
}

/** Viimeisin hetki, jolloin projekti vietiin tiedostoon (JSON-lataus tai yhdistetty tiedosto). */
export async function getLastFileBackupAt(projectId: string): Promise<number | undefined> {
  const row = await db.meta.get(`fileBackup:${projectId}`)
  return row ? Number(row.value) : undefined
}
export async function setLastFileBackupAt(projectId: string, at: number): Promise<void> {
  await db.meta.put({ key: `fileBackup:${projectId}`, value: String(at) })
}
