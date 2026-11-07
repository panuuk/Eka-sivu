import type { Offer } from '../types'

/**
 * ESIMERKKIDATAA – hinnat ja päivämäärät ovat keksittyjä.
 * Niiden tarkoitus on näyttää, miltä sivu näyttää oikeilla tarjouksilla.
 * Korvataan myöhemmin käyttäjien ilmoittamilla tarjouksilla.
 */
export const exampleOffers: Offer[] = [
  { id: 'e1', productId: 'juhla-mokka', chainId: 'prisma', price: 6.49, normalPrice: 8.79, memberPrice: true, validFrom: '2026-11-05', validTo: '2026-11-11', source: 'esimerkki' },
  { id: 'e2', productId: 'juhla-mokka', chainId: 'k-citymarket', price: 6.29, normalPrice: 8.89, memberPrice: true, validFrom: '2026-11-06', validTo: '2026-11-09', source: 'esimerkki' },
  { id: 'e3', productId: 'juhla-mokka', chainId: 'lidl', price: 6.99, memberPrice: false, validFrom: '2026-11-03', validTo: '2026-11-08', source: 'esimerkki' },
  { id: 'e4', productId: 'presidentti', chainId: 's-market', price: 6.79, normalPrice: 9.19, memberPrice: false, validFrom: '2026-11-04', validTo: '2026-11-10', source: 'esimerkki' },
  { id: 'e5', productId: 'presidentti', chainId: 'k-supermarket', price: 7.19, normalPrice: 9.29, memberPrice: true, validFrom: '2026-11-06', validTo: '2026-11-12', source: 'esimerkki' },
  { id: 'e6', productId: 'kulta-katriina', chainId: 'k-market', price: 5.99, normalPrice: 8.49, memberPrice: true, validFrom: '2026-11-06', validTo: '2026-11-09', source: 'esimerkki' },
  { id: 'e7', productId: 'kulta-katriina', chainId: 'sale', price: 6.49, memberPrice: false, validFrom: '2026-11-02', validTo: '2026-11-08', source: 'esimerkki' },
  { id: 'e8', productId: 'paulig-brazil', chainId: 'prisma', price: 6.89, normalPrice: 8.99, memberPrice: false, validFrom: '2026-11-09', validTo: '2026-11-15', source: 'esimerkki' },
  { id: 'e9', productId: 'meira-kulta', chainId: 'k-citymarket', price: 5.79, normalPrice: 7.99, memberPrice: false, validFrom: '2026-11-05', validTo: '2026-11-11', source: 'esimerkki' },
  { id: 'e10', productId: 'lofbergs-lila', chainId: 's-market', price: 6.95, normalPrice: 8.95, memberPrice: true, validFrom: '2026-10-27', validTo: '2026-11-02', source: 'esimerkki' },
  { id: 'e11', productId: 'rainbow', chainId: 'prisma', price: 5.49, normalPrice: 6.59, memberPrice: false, validFrom: '2026-11-04', validTo: '2026-11-17', source: 'esimerkki' },
  { id: 'e12', productId: 'pirkka', chainId: 'k-supermarket', price: 5.59, normalPrice: 6.69, memberPrice: true, validFrom: '2026-11-06', validTo: '2026-11-12', source: 'esimerkki' },
  { id: 'e13', productId: 'bellarom', chainId: 'lidl', price: 4.99, normalPrice: 5.99, memberPrice: true, validFrom: '2026-11-03', validTo: '2026-11-09', source: 'esimerkki' },
]
