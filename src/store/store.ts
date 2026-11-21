import { create } from 'zustand'
import { createProject } from '../model/factory'
import { applyOperations, OperationError, type Operation } from '../model/operations'
import { parseProjectJson } from '../model/serialize'
import type { Project } from '../model/types'
import { newId } from '../model/ids'
import { runProjectActivated, runProjectSaved } from './hooks'
import {
  addBackup,
  deleteProject as dbDelete,
  getActiveProjectId,
  listProjects,
  loadProject,
  saveProject,
  setActiveProjectId,
  type ProjectSummary,
} from '../storage/db'

const HISTORY_LIMIT = 200
const COALESCE_MS = 1200
const SAVE_DEBOUNCE_MS = 400

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface DispatchOptions {
  /** Peräkkäiset operaatiot samalla avaimella (esim. tekstin kirjoitus) yhdistyvät yhdeksi kumoamisaskeleeksi. */
  coalesceKey?: string
}

export interface Selection {
  nodeIds: string[]
  edgeIds: string[]
}

export interface AppState {
  ready: boolean
  project: Project | null
  projects: ProjectSummary[]
  past: Project[]
  future: Project[]
  currentProcessId: string
  selection: Selection
  saveStatus: SaveStatus
  error: string | null

  init: () => Promise<void>
  dispatch: (ops: Operation | Operation[], opts?: DispatchOptions) => boolean
  undo: () => void
  redo: () => void
  setCurrentProcess: (id: string) => void
  select: (sel: Partial<Selection>) => void
  clearError: () => void
  setError: (message: string) => void

  createProject: (name: string) => Promise<void>
  openProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  importProjectJson: (text: string) => Promise<void>
  /** Ottaa valmiin projektin käyttöön uutena projektina (esim. esimerkki). */
  adoptProject: (project: Project) => Promise<void>
  flushSave: () => Promise<void>
}

let lastCoalesceKey: string | undefined
let lastCoalesceAt = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined

function sanitizeSelection(p: Project, sel: Selection): Selection {
  return {
    nodeIds: sel.nodeIds.filter((id) => p.nodes[id]),
    edgeIds: sel.edgeIds.filter((id) => p.edges[id]),
  }
}

const emptySelection: Selection = { nodeIds: [], edgeIds: [] }

export const useStore = create<AppState>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    set({ saveStatus: 'saving' })
    saveTimer = setTimeout(() => void get().flushSave(), SAVE_DEBOUNCE_MS)
  }

  const activate = async (project: Project) => {
    lastCoalesceKey = undefined
    set({
      project,
      past: [],
      future: [],
      currentProcessId: project.rootProcessId,
      selection: emptySelection,
      error: null,
    })
    await setActiveProjectId(project.id)
    set({ projects: await listProjects() })
    runProjectActivated(project)
  }

  return {
    ready: false,
    project: null,
    projects: [],
    past: [],
    future: [],
    currentProcessId: '',
    selection: emptySelection,
    saveStatus: 'idle',
    error: null,

    async init() {
      try {
        let project: Project | undefined
        const activeId = await getActiveProjectId()
        if (activeId) project = await loadProject(activeId).catch(() => undefined)
        if (!project) {
          const all = await listProjects()
          for (const s of all) {
            project = await loadProject(s.id).catch(() => undefined)
            if (project) break
          }
        }
        if (!project) {
          project = createProject('Ensimmäinen projekti')
          await saveProject(project)
        }
        await activate(project)
      } catch (e) {
        // Tallennus ei ole käytettävissä (esim. yksityinen selaus): jatka muistissa.
        const project = createProject('Ensimmäinen projekti')
        set({
          project,
          currentProcessId: project.rootProcessId,
          error: `Tallennus ei ole käytettävissä: ${(e as Error).message}. Työ säilyy vain tämän istunnon ajan, tallenna se JSON-tiedostoon.`,
          saveStatus: 'error',
        })
      }
      set({ ready: true })
    },

    dispatch(ops, opts = {}) {
      const { project, past } = get()
      if (!project) return false
      const list = Array.isArray(ops) ? ops : [ops]
      if (list.length === 0) return true
      let next: Project
      try {
        next = applyOperations(project, list)
      } catch (e) {
        if (e instanceof OperationError) {
          set({ error: e.message })
          return false
        }
        throw e
      }
      next = { ...next, updatedAt: Date.now() }
      const now = Date.now()
      const coalesce =
        opts.coalesceKey !== undefined &&
        opts.coalesceKey === lastCoalesceKey &&
        now - lastCoalesceAt < COALESCE_MS &&
        past.length > 0
      lastCoalesceKey = opts.coalesceKey
      lastCoalesceAt = now
      const nextPast = coalesce ? past : [...past, project].slice(-HISTORY_LIMIT)
      const sel = sanitizeSelection(next, get().selection)
      const cur = next.processes[get().currentProcessId]
        ? get().currentProcessId
        : next.rootProcessId
      set({
        project: next,
        past: nextPast,
        future: [],
        selection: sel,
        currentProcessId: cur,
        error: null,
      })
      scheduleSave()
      return true
    },

    undo() {
      const { project, past, future } = get()
      if (!project || past.length === 0) return
      const prev = past[past.length - 1]
      lastCoalesceKey = undefined
      set({
        project: { ...prev, updatedAt: Date.now() },
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        selection: sanitizeSelection(prev, get().selection),
        currentProcessId: prev.processes[get().currentProcessId]
          ? get().currentProcessId
          : prev.rootProcessId,
      })
      scheduleSave()
    },

    redo() {
      const { project, past, future } = get()
      if (!project || future.length === 0) return
      const nxt = future[0]
      lastCoalesceKey = undefined
      set({
        project: { ...nxt, updatedAt: Date.now() },
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selection: sanitizeSelection(nxt, get().selection),
        currentProcessId: nxt.processes[get().currentProcessId]
          ? get().currentProcessId
          : nxt.rootProcessId,
      })
      scheduleSave()
    },

    setCurrentProcess(id) {
      const { project } = get()
      if (!project?.processes[id]) return
      set({ currentProcessId: id, selection: emptySelection })
    },

    select(sel) {
      set((s) => ({ selection: { ...s.selection, ...sel } }))
    },

    clearError: () => set({ error: null }),
    setError: (message) => set({ error: message }),

    async createProject(name) {
      await get().flushSave()
      const p = createProject(name.trim() || 'Uusi projekti')
      await saveProject(p)
      await activate(p)
    },

    async openProject(id) {
      await get().flushSave()
      const p = await loadProject(id)
      if (!p) {
        set({ error: 'Projektia ei löytynyt' })
        return
      }
      await activate(p)
    },

    async deleteProject(id) {
      // Poistetun projektin viimeinen tila säilyy varmuuskopiona, jotta virheen voi perua.
      const doomed = get().project?.id === id ? get().project : await loadProject(id)
      if (doomed) await addBackup(doomed, 'deleted').catch(() => undefined)
      await dbDelete(id)
      const { project } = get()
      if (project?.id === id) {
        const rest = await listProjects()
        if (rest.length) {
          const p = await loadProject(rest[0].id)
          if (p) return activate(p)
        }
        const p = createProject('Uusi projekti')
        await saveProject(p)
        return activate(p)
      }
      set({ projects: await listProjects() })
    },

    async importProjectJson(text) {
      try {
        const parsed = parseProjectJson(text)
        // Tuonti ei koskaan ylikirjoita olemassa olevaa projektia: tarvittaessa luodaan uusi tunniste.
        const existing = await listProjects()
        const project: Project = existing.some((s) => s.id === parsed.id)
          ? { ...parsed, id: newId('proj'), name: `${parsed.name} (tuotu)` }
          : parsed
        await get().flushSave()
        await saveProject(project)
        await activate(project)
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    async adoptProject(project) {
      await get().flushSave()
      await saveProject(project)
      await activate(project)
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = undefined
      }
      const { project, saveStatus } = get()
      if (!project || saveStatus === 'idle' || saveStatus === 'saved') return
      try {
        await saveProject(project)
        set({ saveStatus: 'saved', projects: await listProjects() })
        runProjectSaved(project)
      } catch (e) {
        set({ saveStatus: 'error', error: `Tallennus epäonnistui: ${(e as Error).message}` })
      }
    },
  }
})

if (typeof window !== 'undefined') {
  // Älä menetä viimeisiä muutoksia sivua suljettaessa.
  window.addEventListener('pagehide', () => void useStore.getState().flushSave())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void useStore.getState().flushSave()
  })
}
