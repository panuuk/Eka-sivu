import { create } from 'zustand'
import {
  DEFAULT_LLM_CONFIG,
  isLocalUrl,
  listModels,
  llmSuggest,
  LlmError,
  type LlmConfig,
} from '../capture/llm'
import type { EvalSummary } from '../capture/eval/metrics'
import { ruleExtractor, type Suggestion } from '../capture/suggest'
import { useStore } from './store'
import { useUi } from './ui'

const KEY = 'prosessikartta.llm'

function loadConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_LLM_CONFIG
    const c = JSON.parse(raw) as Partial<LlmConfig>
    return {
      baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : DEFAULT_LLM_CONFIG.baseUrl,
      model: typeof c.model === 'string' ? c.model : '',
      temperature: DEFAULT_LLM_CONFIG.temperature,
    }
  } catch {
    return DEFAULT_LLM_CONFIG
  }
}

export interface LlmSourceResult {
  suggestions: Suggestion[]
  /** Lähdetekstin pituus ajohetkellä: jos teksti muuttuu, tulos vanhenee. */
  textLength: number
  model: string
  rejected: number
  chunks: number
  ms: number
}

export interface Benchmark {
  rules: EvalSummary
  llm: EvalSummary
  model: string
  ms: number
}

interface LlmState {
  config: LlmConfig
  models: string[]
  modelsError: string | null
  results: Record<string, LlmSourceResult>
  mode: Record<string, 'rules' | 'llm'>
  running: { label: string; done: number; total: number } | null
  error: string | null
  benchmark: Benchmark | null
  setConfig: (patch: Partial<LlmConfig>) => void
  refreshModels: () => Promise<void>
  setMode: (sourceId: string, mode: 'rules' | 'llm') => void
  runOnSource: (sourceId: string, text: string) => Promise<void>
  runBenchmark: () => Promise<void>
  cancel: () => void
}

let controller: AbortController | null = null

/** Muulle kuin paikalliselle osoitteelle tekstiä ei lähetetä ilman erillistä vahvistusta. */
async function confirmDestination(baseUrl: string): Promise<boolean> {
  if (isLocalUrl(baseUrl)) return true
  return useUi.getState().ask({
    title: 'Osoite ei ole omalla koneellasi',
    message: `Osoite ${baseUrl} ei ole paikallinen. Lähdeteksti lähetetään sinne, eli se poistuu koneeltasi. Käytä tätä vain, jos luotat palvelimeen.`,
    confirmLabel: 'Lähetä silti',
    danger: true,
  })
}

export const useLlm = create<LlmState>((set, get) => ({
  config: loadConfig(),
  models: [],
  modelsError: null,
  results: {},
  mode: {},
  running: null,
  error: null,
  benchmark: null,

  setConfig(patch) {
    const config = { ...get().config, ...patch }
    set({ config })
    try {
      localStorage.setItem(KEY, JSON.stringify({ baseUrl: config.baseUrl, model: config.model }))
    } catch {
      /* ei haittaa */
    }
  },

  async refreshModels() {
    set({ modelsError: null })
    try {
      const models = await listModels(get().config.baseUrl)
      set({ models })
      if (models.length && !models.includes(get().config.model))
        get().setConfig({ model: models[0] })
      if (!models.length)
        set({
          modelsError:
            'Palvelin ei listannut yhtään mallia. Lataa malli (esim. ollama pull llama3.2).',
        })
    } catch (e) {
      set({ models: [], modelsError: (e as Error).message })
    }
  },

  setMode(sourceId, mode) {
    set((s) => ({ mode: { ...s.mode, [sourceId]: mode } }))
  },

  async runOnSource(sourceId, text) {
    const { config } = get()
    const project = useStore.getState().project
    if (!project || get().running) return
    if (!(await confirmDestination(config.baseUrl))) return
    controller = new AbortController()
    const t0 = Date.now()
    set({ error: null, running: { label: 'Kielimalli lukee tekstiä', done: 0, total: 1 } })
    try {
      const r = await llmSuggest(project, sourceId, text, config, {
        signal: controller.signal,
        onProgress: (done, total) =>
          set({ running: { label: 'Kielimalli lukee tekstiä', done, total } }),
      })
      set((s) => ({
        results: {
          ...s.results,
          [sourceId]: {
            suggestions: r.suggestions,
            textLength: text.length,
            model: config.model,
            rejected: r.rejected,
            chunks: r.chunks,
            ms: Date.now() - t0,
          },
        },
        mode: { ...s.mode, [sourceId]: 'llm' },
      }))
    } catch (e) {
      if (!(e instanceof LlmError && e.kind === 'abort')) set({ error: (e as Error).message })
    } finally {
      controller = null
      set({ running: null })
    }
  },

  async runBenchmark() {
    const { config } = get()
    const project = useStore.getState().project
    if (!project || get().running) return
    if (!(await confirmDestination(config.baseUrl))) return
    controller = new AbortController()
    set({ error: null, benchmark: null, running: { label: 'Mittaus', done: 0, total: 1 } })
    try {
      const [{ CORPUS }, metrics] = await Promise.all([
        import('../capture/eval/corpus'),
        import('../capture/eval/metrics'),
      ])
      const t0 = Date.now()
      const rules = await metrics.evaluateExtractor(CORPUS, metrics.ruleRunner(ruleExtractor))
      const llm = await metrics.evaluateExtractor(
        CORPUS,
        async (doc) =>
          (
            await llmSuggest({ entities: {} }, doc.id, doc.text, config, {
              signal: controller?.signal,
            })
          ).suggestions,
        (done, total) => set({ running: { label: 'Mittaus', done, total } }),
      )
      set({ benchmark: { rules, llm, model: config.model, ms: Date.now() - t0 } })
    } catch (e) {
      if (!(e instanceof LlmError && e.kind === 'abort')) set({ error: (e as Error).message })
    } finally {
      controller = null
      set({ running: null })
    }
  },

  cancel() {
    controller?.abort()
  },
}))
