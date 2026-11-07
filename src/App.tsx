import { useMemo, useState } from 'react'
import './App.css'
import { OfferForm } from './components/OfferForm'
import { ProductCard } from './components/ProductCard'
import { chainGroups, getChain } from './data/chains'
import { exampleOffers } from './data/offers'
import { getProduct, products } from './data/products'
import { useUserOffers } from './hooks/useUserOffers'
import { compareOffers, formatDate, formatEuro, offerStatus, pricePerKg, todayIso } from './lib/offers'
import type { ChainGroup, Offer } from './types'

type GroupFilter = 'kaikki' | ChainGroup
type SortMode = 'kilohinta' | 'nimi'

function App() {
  const today = todayIso()
  const [menuOpen, setMenuOpen] = useState(false)
  const [group, setGroup] = useState<GroupFilter>('kaikki')
  const [showInactive, setShowInactive] = useState(false)
  const [sort, setSort] = useState<SortMode>('kilohinta')
  const [formProductId, setFormProductId] = useState(products[0].id)
  const { offers: userOffers, addOffer, removeOffer } = useUserOffers()

  const allOffers = useMemo(() => [...exampleOffers, ...userOffers], [userOffers])

  const visibleOffers = useMemo(
    () =>
      allOffers.filter((offer) => {
        if (group !== 'kaikki' && getChain(offer.chainId).group !== group) return false
        if (!showInactive && offerStatus(offer, today) === 'päättynyt') return false
        return true
      }),
    [allOffers, group, showInactive, today],
  )

  const rows = useMemo(() => {
    const byProduct = products.map((product) => {
      const offers = visibleOffers
        .filter((offer) => offer.productId === product.id)
        .sort((a, b) => compareOffers(a, b, today))
      const best = offers.find((offer) => offerStatus(offer, today) === 'voimassa')
      return { product, offers, bestKg: best ? pricePerKg(best.price, product) : Infinity }
    })
    return byProduct.sort((a, b) =>
      sort === 'nimi'
        ? `${a.product.brand} ${a.product.name}`.localeCompare(`${b.product.brand} ${b.product.name}`, 'fi')
        : a.bestKg - b.bestKg,
    )
  }, [visibleOffers, sort, today])

  const topDeals = useMemo(() => {
    return allOffers
      .filter((offer) => offerStatus(offer, today) === 'voimassa')
      .map((offer) => ({ offer, product: getProduct(offer.productId)! }))
      .sort((a, b) => pricePerKg(a.offer.price, a.product) - pricePerKg(b.offer.price, b.product))
      .slice(0, 3)
  }, [allOffers, today])

  function startReport(productId: string) {
    setFormProductId(productId)
    document.getElementById('ilmoita')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleAdd(offer: Omit<Offer, 'id' | 'source'>) {
    addOffer(offer)
  }

  return (
    <div className="app">
      <header className="header">
        <div className="container header__inner">
          <a className="brand" href="#">
            <span aria-hidden="true">☕</span> Tarjoushaukka
          </a>
          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">Avaa valikko</span>☰
          </button>
          <nav id="main-nav" className={`nav${menuOpen ? ' nav--open' : ''}`}>
            <a href="#tarjoukset" onClick={() => setMenuOpen(false)}>Tarjoukset</a>
            <a href="#ilmoita" onClick={() => setMenuOpen(false)}>Ilmoita tarjous</a>
            <a href="#tietoa" onClick={() => setMenuOpen(false)}>Tietoa</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container hero__inner">
            <div>
              <p className="eyebrow">Kahvi · viikon tarjoukset</p>
              <h1>Mistä kahvi on nyt halvinta?</h1>
              <p className="lead">
                Kahvitarjoukset S-ryhmän, K-ryhmän ja Lidlin ketjuista samassa paikassa. Hinnat
                vertaillaan kilohinnan mukaan, ja kuka tahansa voi ilmoittaa löytämänsä tarjouksen.
              </p>
              <div className="hero__actions">
                <a className="button-primary" href="#tarjoukset">Katso tarjoukset</a>
                <a className="button-secondary" href="#ilmoita">Ilmoita tarjous</a>
              </div>
            </div>

            <aside className="card top-deals" aria-labelledby="top-deals-title">
              <h2 id="top-deals-title">Halvimmat juuri nyt</h2>
              {topDeals.length === 0 ? (
                <p className="muted">Ei voimassa olevia tarjouksia.</p>
              ) : (
                <ol>
                  {topDeals.map(({ offer, product }) => (
                    <li key={offer.id}>
                      <div>
                        <strong>{product.brand} {product.name}</strong>
                        <span className="muted">
                          {getChain(offer.chainId).name} · {formatDate(offer.validTo)} asti
                        </span>
                      </div>
                      <div className="top-deals__price">
                        <strong>{formatEuro(offer.price)}</strong>
                        <span className="muted">{formatEuro(pricePerKg(offer.price, product))}/kg</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </aside>
          </div>
        </section>

        <section id="tarjoukset" className="section">
          <div className="container">
            <div className="notice" role="note">
              <strong>Testiversio:</strong> valmiiksi listatut tarjoukset ovat keksittyä
              esimerkkidataa, eivät oikeita hintoja.
            </div>

            <div className="section__head">
              <h2>Kahvitarjoukset</h2>
              <div className="filters">
                <div className="segmented" role="group" aria-label="Kaupparyhmä">
                  {(['kaikki', ...chainGroups] as GroupFilter[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={group === g}
                      onClick={() => setGroup(g)}
                    >
                      {g === 'kaikki' ? 'Kaikki' : g}
                    </button>
                  ))}
                </div>
                <label className="inline-field">
                  Järjestys
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                    <option value="kilohinta">Halvin kilohinta</option>
                    <option value="nimi">Aakkosjärjestys</option>
                  </select>
                </label>
                <label className="inline-field">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                  />
                  Näytä päättyneet
                </label>
              </div>
            </div>

            <div className="grid">
              {rows.map(({ product, offers }) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  offers={offers}
                  today={today}
                  onReport={startReport}
                  onRemove={removeOffer}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="ilmoita" className="section section--alt">
          <div className="container">
            <div className="section__head">
              <h2>Ilmoita tarjous</h2>
              <p className="muted">
                Näitkö kaupassa tai tarjouslehdessä hyvän kahvitarjouksen? Lisää se listaan.
              </p>
            </div>
            <OfferForm productId={formProductId} onProductChange={setFormProductId} onSubmit={handleAdd} />
          </div>
        </section>

        <section id="tietoa" className="section">
          <div className="container about">
            <div>
              <h2>Miten tämä toimii?</h2>
              <p>
                Tarjoushaukka keskittyy tarjouksiin. Normaalihintoja ei seurata, koska ne ovat
                ketjuissa yleensä samat ja muuttuvat harvoin. Hinnat ilmoitetaan ketjutasolla, sillä
                saman ketjun kaupoissa tarjoukset ovat useimmiten samat.
              </p>
              <p>
                Vertailu tehdään kilohinnan mukaan, jotta eri kokoiset paketit ovat vertailukelpoisia.
                Kanta-asiakashinnat (S-Etukortti, Plussa, Lidl Plus) on merkitty erikseen.
              </p>
            </div>
            <div>
              <h2>Tulossa</h2>
              <ul className="roadmap">
                <li>Yhteinen tietokanta, jolloin ilmoitukset näkyvät kaikille</li>
                <li>Tarjousten vahvistaminen ja virheellisten ilmoittaminen</li>
                <li>Suomalaisten tyypillisen ostoskorin muut perustuotteet</li>
                <li>Hintahälytykset suosikkituotteille</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p>© {new Date().getFullYear()} Tarjoushaukka · harrasteprojekti</p>
        </div>
      </footer>
    </div>
  )
}

export default App
