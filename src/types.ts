export type ChainGroup = 'S-ryhmä' | 'K-ryhmä' | 'Lidl'

export type ChainId =
  | 'prisma'
  | 's-market'
  | 'sale'
  | 'k-citymarket'
  | 'k-supermarket'
  | 'k-market'
  | 'lidl'

export type Chain = {
  id: ChainId
  name: string
  group: ChainGroup
}

export type Product = {
  id: string
  brand: string
  name: string
  /** Paketin koko grammoina */
  grams: number
  /** Paahtoaste 1 (vaalea) – 4 (tumma) */
  roast: 1 | 2 | 3 | 4
  /** Jos tuotetta myydään vain tietyissä ketjuissa (esim. kauppojen omat merkit) */
  onlyIn?: ChainId[]
}

export type OfferSource = 'esimerkki' | 'käyttäjä'

export type Offer = {
  id: string
  productId: string
  chainId: ChainId
  /** Tarjoushinta euroina */
  price: number
  /** Normaalihinta, jos tiedossa */
  normalPrice?: number
  /** Vaatiiko tarjous kanta-asiakaskortin (S-Etukortti, Plussa, Lidl Plus) */
  memberPrice: boolean
  /** ISO-päivämäärä YYYY-MM-DD */
  validFrom: string
  /** ISO-päivämäärä YYYY-MM-DD */
  validTo: string
  source: OfferSource
}

export type OfferStatus = 'voimassa' | 'tulossa' | 'päättynyt'
