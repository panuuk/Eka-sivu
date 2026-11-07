# Tarjoushaukka

Harrasteprojekti, joka kokoaa suomalaisten ruokakauppaketjujen tarjoukset yhteen paikkaan.
Ensimmäisenä tuotteena on **kahvi**: 10 suosittua suodatinkahvia ja niiden tarjoukset
S-ryhmän (Prisma, S-market, Sale), K-ryhmän (K-Citymarket, K-Supermarket, K-Market) ja Lidlin ketjuissa.

## Toiminnot

- Tarjoukset tuotteittain, halvin voimassa oleva tarjous korostettuna
- Vertailu kilohinnan mukaan, alennusprosentti ja kanta-asiakashinnat merkittynä
- Suodatus kaupparyhmän mukaan, järjestys kilohinnan tai nimen mukaan
- "Halvimmat juuri nyt" -nosto etusivulla
- Käyttäjä voi ilmoittaa tarjouksen lomakkeella (staattisessa versiossa tallentuu vain omaan selaimeen, `localStorage`)

> Valmiiksi listatut tarjoukset (`src/data/offers.ts`) ovat **keksittyä esimerkkidataa**.

## Tekniikka

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
│   ├── App.tsx         # pääsivu: nosto, suodattimet, tuotelista, lomake
│   ├── App.css         # sivun tyylit
│   ├── types.ts        # tietomalli (ketju, tuote, tarjous)
│   ├── data/           # ketjut, tuotteet ja esimerkkitarjoukset
│   ├── lib/offers.ts   # kilohinta, voimassaolo, muotoilu
│   ├── hooks/          # käyttäjän ilmoittamat tarjoukset (localStorage)
│   ├── components/     # ProductCard, OfferForm, RoastMeter
│   ├── index.css       # globaalit tyylit ja teemamuuttujat
│   └── vite-env.d.ts   # Viten tyyppimäärittelyt
├── vite.config.ts
├── tsconfig.json       # projektiviittaukset
├── tsconfig.app.json   # sovelluskoodin TS-asetukset
└── tsconfig.node.json  # vite.config.ts:n TS-asetukset
```
