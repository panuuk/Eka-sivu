import { create } from 'zustand'
import { EMPTY_FILTER, type Filter } from '../analysis/search'
import { DEFAULT_THEME, sanitizeTheme, type Theme } from '../export/theme'

export type ViewMode = 'canvas' | 'list' | 'sources'
export type Direction = 'DOWN' | 'RIGHT'
/** Kaavion asettelutapa: vapaa (muokattava), uimaradat (rooleittain) tai kokonaiskuva (alaprosessit auki). */
export type LayoutMode = 'free' | 'lanes' | 'overview'

export interface PresentOptions {
  /** Avaa alaprosessit samaan kuvaan. */
  expand: boolean
  /** Vain vahvistetut vaiheet. */
  onlyConfirmed: boolean
  showRoles: boolean
  showSystems: boolean
  /** Varmuus näkyviin (arvaus katkoviivalla). Esityksessä oletuksena pois. */
  showUncertainty: boolean
}

export const DEFAULT_PRESENT: PresentOptions = {
  expand: false,
  onlyConfirmed: false,
  showRoles: true,
  showSystems: true,
  showUncertainty: false,
}

interface Persisted {
  theme: Theme
  present: PresentOptions
  view: ViewMode
  direction: Direction
  layoutMode: LayoutMode
  leftOpen: boolean
  rightOpen: boolean
}

const KEY = 'prosessikartta.ui'

function load(): Persisted {
  // Pienellä näytöllä paneelit ovat oletuksena kiinni, koska ne peittäisivät kaavion.
  const small = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches
  const fallback: Persisted = {
    theme: DEFAULT_THEME,
    present: DEFAULT_PRESENT,
    view: 'canvas',
    direction: 'DOWN',
    layoutMode: 'free',
    leftOpen: !small,
    rightOpen: !small,
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const stored = JSON.parse(raw) as Partial<Persisted>
    return {
      ...fallback,
      ...stored,
      theme: sanitizeTheme(stored.theme),
      present: { ...DEFAULT_PRESENT, ...(stored.present ?? {}) },
    }
  } catch {
    return fallback
  }
}

function persist(s: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ei haittaa: asetukset eivät ole kriittisiä */
  }
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

export interface PromptRequest {
  title: string
  label: string
  initial: string
  confirmLabel: string
  resolve: (value: string | null) => void
}

interface UiState extends Persisted {
  confirm: ConfirmRequest | null
  promptReq: PromptRequest | null
  /** Kysyy tekstiä; palauttaa null, jos käyttäjä peruu. */
  prompt: (opts: {
    title: string
    label: string
    initial?: string
    confirmLabel?: string
  }) => Promise<string | null>
  closePrompt: (value: string | null) => void
  /** Leikepöydällä olevien vaiheiden määrä (liitä-painikkeen tila). */
  clipSize: number
  setClipSize: (n: number) => void
  replaceOpen: boolean
  setReplaceOpen: (open: boolean) => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  entityManagerOpen: boolean
  /** Tallennus ja varmuuskopiot -ikkuna. */
  storageOpen: boolean
  setStorageOpen: (open: boolean) => void
  /** Esitystila: siisti koko ruudun näkymä. */
  presenting: boolean
  setPresenting: (on: boolean) => void
  setTheme: (patch: Partial<Theme>) => void
  setPresentOptions: (patch: Partial<PresentOptions>) => void
  exportOpen: boolean
  setExportOpen: (open: boolean) => void
  /** Haku ja suodattimet (kaavio ja lista himmentävät ei-osuvat vaiheet). */
  filter: Filter
  setFilter: (patch: Partial<Filter>) => void
  clearFilter: () => void
  /** Kaavio keskittyy tähän vaiheeseen, kun se on näkyvissä. */
  centerRequest: { nodeId: string; nonce: number } | null
  requestCenter: (nodeId: string) => void
  clearCenterRequest: () => void
  /** Kaavio vierittää vaiheen näkyviin (ei muuta zoomia), esim. nuolinäppäinnavigoinnin jälkeen. */
  revealRequest: { nodeId: string; nonce: number } | null
  requestReveal: (nodeId: string) => void
  clearRevealRequest: () => void
  rightTab: 'props' | 'questions'
  setRightTab: (t: 'props' | 'questions') => void
  /** Avaa oikean paneelin annetulle välilehdelle. */
  showRight: (t: 'props' | 'questions') => void
  /** Lähdenäkymässä avoinna oleva lähde. */
  openSourceId: string | null
  /** Kohta, johon lähdenäkymä vierittää ja jonka se korostaa. `nonce` pakottaa päivityksen samalle kohdalle. */
  focusRef: { sourceId: string; start: number; end: number; nonce: number } | null
  /** Juuri luotu muistiinpano, joka avataan suoraan muokattavaksi. */
  pendingEditSourceId: string | null
  setPendingEditSource: (id: string | null) => void
  sourcesTab: 'selection' | 'suggestions' | 'refs'
  setSourcesTab: (t: 'selection' | 'suggestions' | 'refs') => void
  /** Hetkeksi korostettu tekstikohta lähdenäkymässä. */
  flash: { start: number; end: number } | null
  flashRange: (start: number, end: number, ms?: number) => void
  setOpenSource: (id: string | null) => void
  focusSourceRef: (sourceId: string, start: number, end: number) => void
  quickOpen: boolean
  quickTab: 'add' | 'export'
  /** Pikasyötteen keskeneräinen teksti säilyy, vaikka ikkuna suljetaan. */
  quickDraft: string
  openQuick: (tab?: 'add' | 'export', draft?: string) => void
  closeQuick: () => void
  setQuickDraft: (text: string) => void
  /** Solmu, jonka nimeä muokataan kaaviossa tai listassa. */
  editNodeId: string | null
  setEditNode: (id: string | null) => void
  setView: (v: ViewMode) => void
  setDirection: (d: Direction) => void
  setLayoutMode: (m: LayoutMode) => void
  toggleLeft: () => void
  toggleRight: () => void
  setRightOpen: (open: boolean) => void
  setEntityManagerOpen: (open: boolean) => void
  /** Näyttää vahvistusikkunan; palauttaa true, jos käyttäjä vahvisti. */
  ask: (opts: {
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
  }) => Promise<boolean>
  closeConfirm: (ok: boolean) => void
}

export const useUi = create<UiState>((set, get) => {
  const save = () => {
    const { theme, present, view, direction, layoutMode, leftOpen, rightOpen } = get()
    persist({ theme, present, view, direction, layoutMode, leftOpen, rightOpen })
  }
  return {
    ...load(),
    confirm: null,
    promptReq: null,
    prompt: (opts) =>
      new Promise<string | null>((resolve) => {
        set({
          promptReq: {
            title: opts.title,
            label: opts.label,
            initial: opts.initial ?? '',
            confirmLabel: opts.confirmLabel ?? 'OK',
            resolve,
          },
        })
      }),
    closePrompt: (value) => {
      const r = get().promptReq
      if (!r) return
      set({ promptReq: null })
      r.resolve(value)
    },
    clipSize: 0,
    setClipSize: (clipSize) => set({ clipSize }),
    replaceOpen: false,
    setReplaceOpen: (replaceOpen) => set({ replaceOpen }),
    helpOpen: false,
    setHelpOpen: (helpOpen) => set({ helpOpen }),
    entityManagerOpen: false,
    storageOpen: false,
    setStorageOpen: (storageOpen) => set({ storageOpen }),
    presenting: false,
    setPresenting: (presenting) => set({ presenting }),
    setTheme: (patch) => {
      set((st) => ({ theme: sanitizeTheme({ ...st.theme, ...patch }) }))
      save()
    },
    setPresentOptions: (patch) => {
      set((st) => ({ present: { ...st.present, ...patch } }))
      save()
    },
    exportOpen: false,
    setExportOpen: (exportOpen) => set({ exportOpen }),
    filter: EMPTY_FILTER,
    setFilter: (patch) => set((st) => ({ filter: { ...st.filter, ...patch } })),
    clearFilter: () => set({ filter: EMPTY_FILTER }),
    centerRequest: null,
    requestCenter: (nodeId) => set({ centerRequest: { nodeId, nonce: Date.now() } }),
    clearCenterRequest: () => set({ centerRequest: null }),
    revealRequest: null,
    requestReveal: (nodeId) => set({ revealRequest: { nodeId, nonce: Date.now() } }),
    clearRevealRequest: () => set({ revealRequest: null }),
    rightTab: 'props',
    setRightTab: (rightTab) => set({ rightTab }),
    showRight: (rightTab) => {
      set({ rightTab, rightOpen: true })
      save()
    },
    openSourceId: null,
    focusRef: null,
    pendingEditSourceId: null,
    setPendingEditSource: (pendingEditSourceId) => set({ pendingEditSourceId }),
    sourcesTab: 'suggestions',
    setSourcesTab: (sourcesTab) => set({ sourcesTab }),
    flash: null,
    flashRange: (start, end, ms = 2400) => {
      const mine = { start, end }
      set({ flash: mine })
      setTimeout(() => {
        if (get().flash === mine) set({ flash: null })
      }, ms)
    },
    setOpenSource: (openSourceId) => set({ openSourceId }),
    focusSourceRef: (sourceId, start, end) => {
      set({
        view: 'sources',
        openSourceId: sourceId,
        sourcesTab: 'refs',
        focusRef: { sourceId, start, end, nonce: Date.now() },
      })
      get().flashRange(start, end, 2600)
      save()
    },
    quickOpen: false,
    quickTab: 'add',
    quickDraft: '',
    openQuick: (tab = 'add', draft) =>
      set((s) => ({ quickOpen: true, quickTab: tab, quickDraft: draft ?? s.quickDraft })),
    closeQuick: () => set({ quickOpen: false }),
    setQuickDraft: (quickDraft) => set({ quickDraft }),
    editNodeId: null,
    setEditNode: (editNodeId) => set({ editNodeId }),
    setView: (view) => {
      set({ view })
      save()
    },
    setDirection: (direction) => {
      set({ direction })
      save()
    },
    setLayoutMode: (layoutMode) => {
      set({ layoutMode })
      save()
    },
    toggleLeft: () => {
      set((s) => ({ leftOpen: !s.leftOpen }))
      save()
    },
    toggleRight: () => {
      set((s) => ({ rightOpen: !s.rightOpen }))
      save()
    },
    setRightOpen: (rightOpen) => {
      set({ rightOpen })
      save()
    },
    setEntityManagerOpen: (entityManagerOpen) => set({ entityManagerOpen }),
    ask: (opts) =>
      new Promise<boolean>((resolve) => {
        set({
          confirm: {
            title: opts.title,
            message: opts.message,
            confirmLabel: opts.confirmLabel ?? 'Vahvista',
            danger: opts.danger ?? false,
            resolve,
          },
        })
      }),
    closeConfirm: (ok) => {
      const c = get().confirm
      if (!c) return
      set({ confirm: null })
      c.resolve(ok)
    },
  }
})
