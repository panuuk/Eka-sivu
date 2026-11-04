# React + TypeScript + Vite

Yksinkertainen responsiivinen React-sovellus, joka on rakennettu TypeScriptillä Viten päälle.

## Ominaisuudet

- React 19 + TypeScript (strict-tila)
- Vite 7 kehityspalvelimena ja bundlerina
- Responsiivinen asettelu (CSS Grid, mobiilivalikko alle 640 px leveydellä)
- Vaalea ja tumma teema käyttöjärjestelmän asetuksen mukaan (`prefers-color-scheme`)

## Vaatimukset

- Node.js 20.19+ tai 22.12+
- npm

## Käyttö

```bash
npm install      # asenna riippuvuudet
npm run dev      # käynnistä kehityspalvelin (http://localhost:5173)
npm run build    # tyyppitarkistus + tuotantobuild hakemistoon dist/
npm run preview  # esikatsele tuotantobuildia
```

## Rakenne

```
.
├── index.html          # HTML-pohja, josta Vite lataa sovelluksen
├── public/             # staattiset tiedostot (favicon)
├── src/
│   ├── main.tsx        # sovelluksen käynnistys
│   ├── App.tsx         # pääkomponentti
│   ├── App.css         # komponentin tyylit
│   ├── index.css       # globaalit tyylit ja teemamuuttujat
│   └── vite-env.d.ts   # Viten tyyppimäärittelyt
├── vite.config.ts
├── tsconfig.json       # projektiviittaukset
├── tsconfig.app.json   # sovelluskoodin TS-asetukset
└── tsconfig.node.json  # vite.config.ts:n TS-asetukset
```
