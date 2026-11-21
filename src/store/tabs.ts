import { create } from 'zustand'

/**
 * Tunnistaa, onko sovellus auki myös toisessa välilehdessä. Kaksi välilehteä, jotka tallentavat
 * samaan projektiin, ylikirjoittaisivat toistensa muutoksia, joten käyttäjälle ilmoitetaan.
 */
interface TabsState {
  otherTabOpen: boolean
  dismiss: () => void
}

export const useTabs = create<TabsState>((set) => ({
  otherTabOpen: false,
  dismiss: () => set({ otherTabOpen: false }),
}))

export function watchOtherTabs() {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel('prosessikartta-tabs')
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === 'hello') {
      // Toinen välilehti avautui: kerro, että olemme täällä, ja varoita itse myös.
      channel.postMessage('present')
      useTabs.setState({ otherTabOpen: true })
    } else if (e.data === 'present') {
      useTabs.setState({ otherTabOpen: true })
    }
  }
  channel.postMessage('hello')
}
