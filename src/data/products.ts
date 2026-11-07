import type { Product } from '../types'
import { chainsInGroup } from './chains'

/**
 * Ensimmäisen version kahvivalikoima: suosittuja suodatinkahveja.
 * Lista on luonnos – tuotteet ja pakkauskoot kannattaa tarkistaa kauppojen valikoimista.
 */
export const products: Product[] = [
  { id: 'juhla-mokka', brand: 'Paulig', name: 'Juhla Mokka', grams: 500, roast: 2 },
  { id: 'presidentti', brand: 'Paulig', name: 'Presidentti', grams: 500, roast: 2 },
  { id: 'kulta-katriina', brand: 'Kulta Katriina', name: 'Suodatinkahvi', grams: 500, roast: 2 },
  { id: 'paulig-brazil', brand: 'Paulig', name: 'Brazil', grams: 500, roast: 2 },
  { id: 'meira-kulta', brand: 'Meira', name: 'Kulta', grams: 500, roast: 2 },
  { id: 'lofbergs-lila', brand: 'Löfbergs', name: 'Lila', grams: 500, roast: 3 },
  { id: 'arvid-nordquist', brand: 'Arvid Nordquist', name: 'Classic', grams: 500, roast: 3 },
  {
    id: 'rainbow',
    brand: 'Rainbow',
    name: 'Suodatinkahvi',
    grams: 500,
    roast: 2,
    onlyIn: chainsInGroup('S-ryhmä'),
  },
  {
    id: 'pirkka',
    brand: 'Pirkka',
    name: 'Suodatinkahvi',
    grams: 500,
    roast: 2,
    onlyIn: chainsInGroup('K-ryhmä'),
  },
  {
    id: 'bellarom',
    brand: 'Bellarom',
    name: 'Suodatinkahvi',
    grams: 500,
    roast: 2,
    onlyIn: ['lidl'],
  },
]

const productMap = new Map(products.map((product) => [product.id, product]))

export function getProduct(id: string): Product | undefined {
  return productMap.get(id)
}
