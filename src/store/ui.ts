import { create } from 'zustand'

export type ViewMode = 'canvas' | 'list'
export type Direction = 'DOWN' | 'RIGHT'

interface Persisted {
  view: ViewMode
  direction: Direction
  leftOpen: boolean
  rightOpen: boolean
}

const KEY = 'prosessikartta.ui'

function load(): Persisted {
  // Pienellä näytöllä paneelit ovat oletuksena kiinni, koska ne peittäisivät kaavion.
  const small = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches
  const fallback: Persisted = {
    view: 'canvas',
    direction: 'DOWN',
    leftOpen: !small,
    rightOpen: !small,
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<Persisted>) }
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
  entityManagerOpen: boolean
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
    const { view, direction, leftOpen, rightOpen } = get()
    persist({ view, direction, leftOpen, rightOpen })
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
    entityManagerOpen: false,
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
