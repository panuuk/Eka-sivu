import { useSyncExternalStore } from 'react'

/** Seuraa CSS-mediakyselyä. Palvelinpuolella ja ilman matchMediaa vastaus on false. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  )
}

/** Puhelimen levyinen näyttö: toissijaiset toiminnot kootaan valikkoon ja työkalut paneeliin. */
export const NARROW_QUERY = '(max-width: 700px)'
export const useNarrow = () => useMedia(NARROW_QUERY)
