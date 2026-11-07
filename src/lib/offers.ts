import type { Offer, OfferStatus, Product } from '../types'

/** Paikallinen päivämäärä muodossa YYYY-MM-DD */
export function todayIso(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function offerStatus(offer: Offer, today: string): OfferStatus {
  if (today < offer.validFrom) return 'tulossa'
  if (today > offer.validTo) return 'päättynyt'
  return 'voimassa'
}

export function pricePerKg(price: number, product: Product): number {
  return (price / product.grams) * 1000
}

export function discountPercent(offer: Offer): number | null {
  if (!offer.normalPrice || offer.normalPrice <= offer.price) return null
  return Math.round((1 - offer.price / offer.normalPrice) * 100)
}

const euro = new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' })

export function formatEuro(value: number): string {
  return euro.format(value)
}

export function formatDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.`
}

const statusOrder: Record<OfferStatus, number> = { voimassa: 0, tulossa: 1, päättynyt: 2 }

/** Voimassa olevat ensin, sitten halvin ensin */
export function compareOffers(a: Offer, b: Offer, today: string): number {
  const byStatus = statusOrder[offerStatus(a, today)] - statusOrder[offerStatus(b, today)]
  return byStatus !== 0 ? byStatus : a.price - b.price
}
