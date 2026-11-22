import { create } from 'zustand'
import { downloadText, safeFilename } from '../export/download'
import { newId } from '../model/ids'
import { parseProjectJson, projectToJson } from '../model/serialize'
import type { Project } from '../model/types'
import {
  addBackup,
  deleteBackups,
  deleteFileLink,
  getFileLink,
  getLastFileBackupAt,
  listBackups,
  listProjects,
  loadBackup,
  putFileLink,
  setLastFileBackupAt,
  type BackupMeta,
  type BackupReason,
} from '../storage/db'
import { selectBackupsToPrune, shouldAutoBackup } from '../storage/backupPolicy'
import {
  fileAccessSupported,
  hasWritePermission,
  pickOpenFile,
  pickSaveFile,
  readTextFile,
  requestWritePermission,
  writeTextFile,
  type FileHandle,
} from '../storage/fileAccess'
import { onProjectActivated, onProjectSaved } from './hooks'
import { useStore } from './store'
import { useUi } from './ui'

type FileLinkStatus = 'ok' | 'needs-permission' | 'error'

interface FileLinkState {
  projectId: string
  fileName: string
  status: FileLinkStatus
  lastWriteAt?: number
  message?: string
}

interface StorageInfo {
  persisted: boolean | null
  usage: number | null
  quota: number | null
}

interface StorageState {
  backups: BackupMeta[]
  fileLink: FileLinkState | null
  lastFileBackupAt: number | undefined
  info: StorageInfo
  supported: boolean
  /** Tiedostoon kirjoitus on käynnissä tai odottaa. */
  fileWritePending: boolean

  refresh: () => Promise<void>
  refreshInfo: () => Promise<void>
  backupNow: (reason?: BackupReason) => Promise<void>
  restoreBackup: (id: string, mode: 'replace' | 'copy') => Promise<void>
  removeBackup: (id: string) => Promise<void>
  exportJson: () => Promise<void>
  linkToNewFile: () => Promise<void>
  openFromFile: () => Promise<void>
  resumeFileLink: () => Promise<void>
  unlinkFile: () => Promise<void>
}

let fileWriteDelay = 1500

/** Vain testejä varten. */
export function setFileWriteDelayForTests(ms: number) {
  fileWriteDelay = ms
}

let handles = new Map<string, FileHandle>()
let fileTimer: ReturnType<typeof setTimeout> | undefined
let persistAsked = false

/** Vain testejä varten. */
export function resetStorageStateForTests() {
  handles = new Map()
  if (fileTimer) clearTimeout(fileTimer)
  fileTimer = undefined
  pendingProject = null
  persistAsked = false
  latestBackup.clear()
  useStorage.setState({ backups: [], fileLink: null, lastFileBackupAt: undefined })
}

const latestBackup = new Map<string, Pick<BackupMeta, 'createdAt' | 'projectUpdatedAt'> | null>()
let backupChain: Promise<unknown> = Promise.resolve()

async function autoBackup(project: Project) {
  let latest = latestBackup.get(project.id)
  if (latest === undefined) {
    latest = (await listBackups(project.id))[0] ?? null
    latestBackup.set(project.id, latest)
  }
  const now = Date.now()
  if (!shouldAutoBackup(project, latest ?? undefined, now)) return
  const meta = await addBackup(project, 'auto')
  latestBackup.set(project.id, meta)
  const prune = selectBackupsToPrune(await listBackups(project.id), now)
  await deleteBackups(prune)
  await useStorage.getState().refresh()
}

function setLink(patch: Partial<FileLinkState> | null, projectId?: string) {
  const cur = useStorage.getState().fileLink
  if (patch === null) return useStorage.setState({ fileLink: null })
  if (!cur && !projectId) return
  useStorage.setState({
    fileLink: { ...(cur ?? { projectId: projectId!, fileName: '', status: 'ok' }), ...patch },
  })
}

function currentProject(): Project | null {
  return useStore.getState().project
}

async function writeNow(projectId: string, fallback?: Project) {
  const handle = handles.get(projectId)
  const cur = currentProject()
  // Ensisijaisesti käytetään tuoreinta tilaa; projektin vaihtuessa viimeinen tila on `fallback`.
  const project = cur?.id === projectId ? cur : fallback
  if (!handle || !project) return
  const isCurrent = cur?.id === projectId
  useStorage.setState({ fileWritePending: true })
  try {
    if (!(await hasWritePermission(handle))) {
      if (isCurrent) setLink({ status: 'needs-permission', message: undefined }, projectId)
      return
    }
    await writeTextFile(handle, projectToJson(project))
    const at = Date.now()
    await putFileLink({ projectId, handle, fileName: handle.name, lastWriteAt: at })
    await setLastFileBackupAt(projectId, at)
    if (isCurrent) {
      useStorage.setState({ lastFileBackupAt: at })
      setLink({ status: 'ok', lastWriteAt: at, message: undefined }, projectId)
    }
  } catch (e) {
    if (isCurrent) setLink({ status: 'error', message: (e as Error).message }, projectId)
  } finally {
    useStorage.setState({ fileWritePending: false })
  }
}

let pendingProject: Project | null = null

function scheduleFileWrite(project: Project) {
  const link = useStorage.getState().fileLink
  if (!link || link.projectId !== project.id || link.status === 'needs-permission') return
  if (fileTimer) clearTimeout(fileTimer)
  pendingProject = project
  useStorage.setState({ fileWritePending: true })
  fileTimer = setTimeout(() => {
    fileTimer = undefined
    const p = pendingProject
    pendingProject = null
    if (p) void writeNow(p.id, p)
  }, fileWriteDelay)
}

async function loadLinkFor(project: Project) {
  if (fileTimer) {
    // Projekti vaihtui kesken odotuksen: edellisen projektin viimeinen tila kirjoitetaan heti.
    clearTimeout(fileTimer)
    fileTimer = undefined
    const prev = pendingProject
    pendingProject = null
    if (prev && prev.id !== project.id) void writeNow(prev.id, prev)
  }
  useStorage.setState({
    fileLink: null,
    fileWritePending: false,
    lastFileBackupAt: await getLastFileBackupAt(project.id),
  })
  const row = await getFileLink(project.id)
  if (!row) return
  const handle = row.handle as FileHandle
  handles.set(project.id, handle)
  if (currentProject()?.id !== project.id) return
  const ok = await hasWritePermission(handle)
  setLink(
    {
      projectId: project.id,
      fileName: row.fileName,
      status: ok ? 'ok' : 'needs-permission',
      lastWriteAt: row.lastWriteAt,
    },
    project.id,
  )
}

/** Odottaa, että projektin aktivoinnin taustatyöt (varmuuskopio, yhteyden lataus) ovat valmiit. */
function settled() {
  return backupChain.catch(() => undefined)
}

async function persistLink(projectId: string, handle: FileHandle) {
  await settled()
  handles.set(projectId, handle)
  await putFileLink({ projectId, handle, fileName: handle.name })
  setLink({ projectId, fileName: handle.name, status: 'ok', message: undefined }, projectId)
  await writeNow(projectId)
}

function fail(message: string) {
  useStore.getState().setError(message)
}

export const useStorage = create<StorageState>((set, get) => ({
  backups: [],
  fileLink: null,
  lastFileBackupAt: undefined,
  info: { persisted: null, usage: null, quota: null },
  supported: fileAccessSupported(),
  fileWritePending: false,

  async refresh() {
    set({ backups: await listBackups() })
  },

  async refreshInfo() {
    try {
      const persisted = (await navigator.storage?.persisted?.()) ?? null
      const est = await navigator.storage?.estimate?.()
      set({ info: { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null } })
    } catch {
      /* tieto ei ole saatavilla */
    }
  },

  async backupNow(reason = 'manual') {
    const project = currentProject()
    if (!project) return
    await useStore.getState().flushSave()
    const meta = await addBackup(project, reason)
    if (reason === 'manual') latestBackup.set(project.id, meta)
    await get().refresh()
  },

  async restoreBackup(id, mode) {
    const state = useStore.getState()
    const data = await loadBackup(id)
    if (!data) return fail('Varmuuskopiota ei löytynyt')
    if (mode === 'copy') {
      const copy: Project = {
        ...data,
        id: newId('proj'),
        name: `${data.name} (kopio)`,
        updatedAt: Date.now(),
      }
      await state.adoptProject(copy)
      return
    }
    // Palautus korvaa projektin: nykyinen tila otetaan ensin talteen.
    const existing = (await listProjects()).some((p) => p.id === data.id)
    if (existing) {
      const cur = state.project?.id === data.id ? state.project : null
      if (cur) {
        await state.flushSave()
        await addBackup(cur, 'before-restore')
      }
    }
    await state.adoptProject({ ...data, updatedAt: Date.now() })
    await get().refresh()
  },

  async removeBackup(id) {
    await deleteBackups([id])
    await get().refresh()
  },

  async exportJson() {
    const project = currentProject()
    if (!project) return
    downloadText(
      projectToJson(project),
      `${safeFilename(project.name)}.prosessikartta.json`,
      'application/json',
    )
    const at = Date.now()
    await setLastFileBackupAt(project.id, at)
    set({ lastFileBackupAt: at })
  },

  async linkToNewFile() {
    const project = currentProject()
    if (!project) return
    try {
      const handle = await pickSaveFile(`${safeFilename(project.name)}.prosessikartta.json`)
      if (!handle) return
      await useStore.getState().flushSave()
      await persistLink(project.id, handle)
    } catch (e) {
      fail(`Tiedoston valinta epäonnistui: ${(e as Error).message}`)
    }
  },

  async openFromFile() {
    try {
      const handle = await pickOpenFile()
      if (!handle) return
      const parsed = parseProjectJson(await readTextFile(handle))
      const exists = (await listProjects()).some((p) => p.id === parsed.id)
      let project = parsed
      if (exists) {
        const ok = await useUi.getState().ask({
          title: 'Projekti on jo selaimessa',
          message:
            'Selaimessa on jo projekti samalla tunnuksella. Tiedosto avataan erillisenä kopiona, eikä mitään ylikirjoiteta.',
          confirmLabel: 'Avaa kopiona',
        })
        if (!ok) return
        project = { ...parsed, id: newId('proj'), name: `${parsed.name} (tiedostosta)` }
      }
      await useStore.getState().adoptProject(project)
      await requestWritePermission(handle)
      await persistLink(project.id, handle)
    } catch (e) {
      fail((e as Error).message)
    }
  },

  async resumeFileLink() {
    const link = get().fileLink
    const handle = link && handles.get(link.projectId)
    if (!link || !handle) return
    if (!(await requestWritePermission(handle))) {
      setLink({ status: 'needs-permission', message: 'Lupaa ei annettu' })
      return
    }
    setLink({ status: 'ok', message: undefined })
    await writeNow(link.projectId)
  },

  async unlinkFile() {
    const link = get().fileLink
    if (!link) return
    if (fileTimer) clearTimeout(fileTimer)
    handles.delete(link.projectId)
    await deleteFileLink(link.projectId)
    set({ fileLink: null, fileWritePending: false })
  },
}))

/** Pyytää selainta suojaamaan tallennuksen siivoukselta (kerran istunnossa, ensimmäisen muutoksen jälkeen). */
async function ensurePersistence() {
  if (persistAsked) return
  persistAsked = true
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.()
  } catch {
    /* ei tuettu */
  }
  await useStorage.getState().refreshInfo()
}

onProjectActivated((project) => {
  backupChain = backupChain.then(async () => {
    await autoBackup(project).catch(() => undefined)
    await loadLinkFor(project).catch(() => undefined)
    await useStorage.getState().refresh()
  })
})

onProjectSaved((project) => {
  scheduleFileWrite(project)
  void ensurePersistence()
  backupChain = backupChain.then(() => autoBackup(project).catch(() => undefined))
})

/** Sivua piilotettaessa odottava tiedostokirjoitus tehdään heti. */
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !fileTimer) return
    clearTimeout(fileTimer)
    fileTimer = undefined
    const p = pendingProject
    pendingProject = null
    if (p) void writeNow(p.id, p)
  })
}
