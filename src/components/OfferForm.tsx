import { useState, type FormEvent } from 'react'
import { chains } from '../data/chains'
import { getProduct, products } from '../data/products'
import { todayIso } from '../lib/offers'
import type { ChainId, Offer } from '../types'

type Props = {
  productId: string
  onProductChange: (productId: string) => void
  onSubmit: (offer: Omit<Offer, 'id' | 'source'>) => void
}

function parsePrice(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export function OfferForm({ productId, onProductChange, onSubmit }: Props) {
  const today = todayIso()
  const product = getProduct(productId)
  const availableChains = chains.filter((c) => !product?.onlyIn || product.onlyIn.includes(c.id))

  const [chainId, setChainId] = useState<ChainId>(availableChains[0].id)
  const [price, setPrice] = useState('')
  const [normalPrice, setNormalPrice] = useState('')
  const [memberPrice, setMemberPrice] = useState(false)
  const [validTo, setValidTo] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const selectedChain = availableChains.some((c) => c.id === chainId) ? chainId : availableChains[0].id

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    const parsedPrice = parsePrice(price)
    const parsedNormal = normalPrice.trim() ? parsePrice(normalPrice) : undefined

    if (parsedPrice === null || parsedPrice > 50) {
      setError('Anna tarjoushinta euroina, esim. 6,49.')
      return
    }
    if (parsedNormal === null) {
      setError('Normaalihinta on virheellinen. Jätä kenttä tyhjäksi, jos et tiedä sitä.')
      return
    }
    if (parsedNormal !== undefined && parsedNormal <= parsedPrice) {
      setError('Normaalihinnan pitää olla tarjoushintaa suurempi.')
      return
    }
    if (validTo < today) {
      setError('Tarjouksen viimeinen voimassaolopäivä ei voi olla menneisyydessä.')
      return
    }

    onSubmit({
      productId,
      chainId: selectedChain,
      price: parsedPrice,
      normalPrice: parsedNormal,
      memberPrice,
      validFrom: today,
      validTo,
    })
    setError(null)
    setSaved(true)
    setPrice('')
    setNormalPrice('')
    setMemberPrice(false)
  }

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate>
      <div className="form__grid">
        <label className="field">
          <span>Tuote</span>
          <select value={productId} onChange={(e) => onProductChange(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.name} {p.grams} g
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Kauppa</span>
          <select value={selectedChain} onChange={(e) => setChainId(e.target.value as ChainId)}>
            {availableChains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Tarjoushinta (€)</span>
          <input
            inputMode="decimal"
            placeholder="6,49"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Normaalihinta (€, valinnainen)</span>
          <input
            inputMode="decimal"
            placeholder="8,79"
            value={normalPrice}
            onChange={(e) => setNormalPrice(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Voimassa asti</span>
          <input type="date" min={today} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </label>

        <label className="field field--check">
          <input type="checkbox" checked={memberPrice} onChange={(e) => setMemberPrice(e.target.checked)} />
          <span>Vaatii kanta-asiakaskortin</span>
        </label>
      </div>

      {error && (
        <p className="form__msg form__msg--error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form__msg form__msg--ok" role="status">
          Kiitos! Tarjous lisättiin listaan.
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button-primary">
          Lisää tarjous
        </button>
        <p className="form__note">
          Testiversiossa ilmoitukset tallentuvat vain tämän selaimen muistiin, eivätkä vielä näy
          muille käyttäjille.
        </p>
      </div>
    </form>
  )
}
