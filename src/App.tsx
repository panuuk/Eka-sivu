import { useState } from 'react'
import './App.css'

type Feature = {
  title: string
  text: string
}

const features: Feature[] = [
  {
    title: 'Nopea',
    text: 'Vite tarjoaa salamannopean kehityspalvelimen ja optimoidun tuotantobuildin.',
  },
  {
    title: 'Tyypitetty',
    text: 'TypeScript strict-tilassa auttaa löytämään virheet jo ennen ajoa.',
  },
  {
    title: 'Responsiivinen',
    text: 'Asettelu mukautuu puhelimesta laajakuvanäyttöön CSS Gridin avulla.',
  },
]

function App() {
  const [count, setCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="app">
      <header className="header">
        <div className="container header__inner">
          <a className="brand" href="#">
            React + Vite
          </a>
          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">Avaa valikko</span>☰
          </button>
          <nav id="main-nav" className={`nav ${menuOpen ? 'nav--open' : ''}`}>
            <a href="#ominaisuudet" onClick={() => setMenuOpen(false)}>
              Ominaisuudet
            </a>
            <a href="#laskuri" onClick={() => setMenuOpen(false)}>
              Laskuri
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <h1>Tervetuloa!</h1>
            <p className="hero__lead">
              Yksinkertainen responsiivinen pohja React-, TypeScript- ja Vite-projekteille.
            </p>
          </div>
        </section>

        <section id="ominaisuudet" className="container section">
          <h2>Ominaisuudet</h2>
          <div className="grid">
            {features.map((feature) => (
              <article key={feature.title} className="card">
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="laskuri" className="container section">
          <h2>Laskuri</h2>
          <div className="card counter">
            <p className="counter__value" aria-live="polite">
              {count}
            </p>
            <div className="counter__actions">
              <button onClick={() => setCount((c) => c - 1)}>−</button>
              <button onClick={() => setCount(0)}>Nollaa</button>
              <button onClick={() => setCount((c) => c + 1)}>+</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">© {new Date().getFullYear()} React + Vite</div>
      </footer>
    </div>
  )
}

export default App
