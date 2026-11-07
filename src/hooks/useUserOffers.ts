import { useCallback, useEffect, useState } from 'react'
import type { Offer } from '../types'

const STORAGE_KEY = 'tarjoushaukka:omat-tarjoukset:v1'

function load(): Offer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Offer[]) : []
  } catch {
    return []
  }
}

/**
 * Käyttäjän itse ilmoittamat tarjoukset.
 * Staattisessa versiossa ne tallentuvat vain tämän selaimen muistiin (localStorage).
 */
export function useUserOffers() {
  const [offers, setOffers] = useState<Offer[]>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(offers))
    } catch {
      // Tallennus ei onnistu esim. yksityisessä selausikkunassa – tarjoukset säilyvät istunnon ajan.
    }
  }, [offers])

  const addOffer = useCallback((offer: Omit<Offer, 'id' | 'source'>) => {
    const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    setOffers((prev) => [...prev, { ...offer, id, source: 'käyttäjä' }])
  }, [])

  const removeOffer = useCallback((id: string) => {
    setOffers((prev) => prev.filter((offer) => offer.id !== id))
  }, [])

  return { offers, addOffer, removeOffer }
}
