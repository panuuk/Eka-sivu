import { create } from 'zustand'
import { useStore } from './store/store'

/** Selaimen `beforeinstallprompt`-tapahtuma (ei TypeScriptin DOM-tyypeissä). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  /** Uusi versio on ladattu ja odottaa käyttöönottoa. */
  updateReady: boolean
  /** Sovellus on ladattu offline-käyttöön ensimmäistä kertaa. */
  offlineReady: boolean
  installPrompt: InstallPromptEvent | null
  applyUpdate: () => Promise<void>
  dismissUpdate: () => void
  dismissOffline: () => void
  install: () => Promise<void>
}

let waiting: ServiceWorker | null = null

export const usePwa = create<PwaState>((set, get) => ({
  updateReady: false,
  offlineReady: false,
  installPrompt: null,

  async applyUpdate() {
    // Tallenna keskeneräinen työ ennen sivun latausta.
    await useStore.getState().flushSave()
    waiting?.postMessage({ type: 'SKIP_WAITING' })
  },
  dismissUpdate: () => set({ updateReady: false }),
  dismissOffline: () => set({ offlineReady: false }),

  async install() {
    const ev = get().installPrompt
    if (!ev) return
    await ev.prompt()
    await ev.userChoice
    set({ installPrompt: null })
  },
}))

const OFFLINE_SEEN_KEY = 'prosessikartta.offlineSeen'

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    usePwa.setState({ installPrompt: e as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => usePwa.setState({ installPrompt: null }))

  if (!import.meta.env.PROD) return

  // Ensimmäinen asennus ottaa sivun hallintaan ilman uudelleenlatausta. Vasta sen jälkeinen
  // vaihto (päivitys) lataa sivun uudelleen.
  let hasController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasController) {
      hasController = true
      return
    }
    if (reloading) return
    reloading = true
    location.reload()
  })

  const watch = (sw: ServiceWorker) => {
    const check = () => {
      if (sw.state !== 'installed') return
      if (navigator.serviceWorker.controller) {
        waiting = sw
        usePwa.setState({ updateReady: true })
      } else {
        let seen = false
        try {
          seen = localStorage.getItem(OFFLINE_SEEN_KEY) === '1'
          localStorage.setItem(OFFLINE_SEEN_KEY, '1')
        } catch {
          /* ei haittaa */
        }
        if (!seen) usePwa.setState({ offlineReady: true })
      }
    }
    sw.addEventListener('statechange', check)
    check()
  }

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      if (reg.installing) watch(reg.installing)
      if (reg.waiting) watch(reg.waiting)
      reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing))
      // Tarkista päivitykset, kun välilehti palaa näkyviin.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined)
      })
    })
    .catch((e) => console.warn('Palvelutyöntekijän rekisteröinti epäonnistui', e))
}
