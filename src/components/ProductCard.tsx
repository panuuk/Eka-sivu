import { getChain, memberCardByGroup } from '../data/chains'
import {
  discountPercent,
  formatDate,
  formatEuro,
  offerStatus,
  pricePerKg,
} from '../lib/offers'
import type { Offer, Product } from '../types'
import { RoastMeter } from './RoastMeter'

type Props = {
  product: Product
  /** Valmiiksi järjestetyt tarjoukset (voimassa olevat ja halvin ensin) */
  offers: Offer[]
  today: string
  onReport: (productId: string) => void
  onRemove: (offerId: string) => void
}

export function ProductCard({ product, offers, today, onReport, onRemove }: Props) {
  const cheapestActive = offers.find((offer) => offerStatus(offer, today) === 'voimassa')

  return (
    <article className="card product">
      <header className="product__head">
        <div>
          <p className="product__brand">{product.brand}</p>
          <h3 className="product__name">{product.name}</h3>
        </div>
        <div className="product__meta">
          <span>{product.grams} g</span>
          <RoastMeter roast={product.roast} />
        </div>
      </header>

      {offers.length === 0 ? (
        <p className="product__empty">Ei tiedossa olevia tarjouksia.</p>
      ) : (
        <ul className="offers">
          {offers.map((offer) => {
            const chain = getChain(offer.chainId)
            const status = offerStatus(offer, today)
            const discount = discountPercent(offer)
            const isBest = offer === cheapestActive
            return (
              <li
                key={offer.id}
                className={`offer offer--${status === 'voimassa' ? 'active' : 'inactive'}${isBest ? ' offer--best' : ''}`}
              >
                <div className="offer__chain">
                  <span className={`chip chip--${chain.group === 'S-ryhmä' ? 's' : chain.group === 'K-ryhmä' ? 'k' : 'lidl'}`}>
                    {chain.name}
                  </span>
                  {isBest && <span className="badge badge--best">Halvin</span>}
                  {status !== 'voimassa' && <span className="badge">{status}</span>}
                  {offer.source === 'käyttäjä' && <span className="badge badge--user">Oma ilmoitus</span>}
                </div>
                <div className="offer__price">
                  <strong>{formatEuro(offer.price)}</strong>
                  <span className="offer__unit">{formatEuro(pricePerKg(offer.price, product))}/kg</span>
                </div>
                <div className="offer__details">
                  <span>
                    {formatDate(offer.validFrom)}–{formatDate(offer.validTo)}
                  </span>
                  {discount !== null && (
                    <span>
                      −{discount} % <s>{formatEuro(offer.normalPrice!)}</s>
                    </span>
                  )}
                  {offer.memberPrice && <span>{memberCardByGroup[chain.group]}-hinta</span>}
                  {offer.source === 'käyttäjä' && (
                    <button type="button" className="link-button" onClick={() => onRemove(offer.id)}>
                      Poista
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="product__report" onClick={() => onReport(product.id)}>
        + Ilmoita tarjous
      </button>
    </article>
  )
}
