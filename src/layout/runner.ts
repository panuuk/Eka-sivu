import type { ElkNode } from 'elkjs/lib/elk-api'
import type { LayoutRunner } from './elk'

/** Ajaa ELK-asettelun Web Workerissa, jottei käyttöliittymä jäädy isoilla kaavioilla. */
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (n: ElkNode) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; res?: ElkNode; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error) p.reject(new Error(e.data.error))
    else p.resolve(e.data.res!)
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message))
    pending.clear()
    worker = null
  }
  return worker
}

export const workerRunner: LayoutRunner = (graph) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, graph })
  })
