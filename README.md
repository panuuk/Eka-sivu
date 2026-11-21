# Prosessikartta

Työkalu prosessien hahmottamiseen ja mallintamiseen. Laajojen, tietotyövaltaisten prosessien kuvaaminen ja visualisointi on hidasta, joten työkalu kehittää prosessin mallia pikkuhiljaa syötetyn tiedon perusteella: kirjoita tai liitä teksti, tuo dokumentteja, vastaa työkalun kysymyksiin, ja kaavio tarkentuu.

Kaikki data pysyy omassa selaimessa. Mitään ei lähetetä palvelimelle, eikä työkalu käytä ulkoisia tekoälypalveluja.

## Ominaisuudet

| Alue                       | Mitä tekee                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Malli**                  | Prosessi on rakenteinen graafi (vaiheet, päätökset, alaprosessit, roolit, järjestelmät, syötteet ja tuotokset). Kaavio, lista ja esitys piirretään siitä. Jokaisella vaiheella on varmuustaso (arvaus, todennäköinen, vahvistettu).                                                                                                                                                               |
| **Kaavio**                 | Automaattinen asettelu, jonka voi ylittää käsin. Kolme asettelutapaa: _Vapaa_, _Uimaradat_ (rooleittain riveillä) ja _Kokonaiskuva_ (kaikki alaprosessit auki). Kumoa ja tee uudelleen, pikanäppäimet.                                                                                                                                                                                            |
| **Pikasyöte** (Ctrl+K)     | Kirjoita prosessi tekstinä (ks. syntaksi alla), katso esikatselu ja lisää malliin. Saman tekstin voi lisätä uudelleen ilman kaksoiskappaleita. Prosessin voi viedä takaisin tekstinä ja muokata.                                                                                                                                                                                                  |
| **Lähteet**                | Tuo Word-, PDF-, teksti- ja Markdown-tiedostoja tai kirjoita muistiinpanoja. Työkalu ehdottaa tekstistä vaiheita, päätöksiä, rooleja ja järjestelmiä (sääntöpohjaisesti, suomen taivutukset huomioiden). Jokainen poiminta muistaa lähdekohdan, ja siihen pääsee takaisin kaaviosta.                                                                                                              |
| **Tarkentuminen**          | Työkalu löytää mallin aukot (puuttuva rooli, umpikuja, päätös ilman haaraa, arvaus ilman lähdettä, lähteen ja mallin ristiriita ym.) ja esittää ne kysymyksinä. Vastaus korjaa mallin. Valmiusaste näkyy koko ajan.                                                                                                                                                                               |
| **Laajat prosessit**       | Hierarkia (alaprosessit), haku ja suodattimet, uimaradat, kokonaiskuva, ristiviittaukset (missä rooli tai järjestelmä on käytössä). Sujuva yli 500 vaiheen malleilla.                                                                                                                                                                                                                             |
| **Tallennus**              | Automaattitallennus selaimeen, automaattiset varmuuskopiot, tallennus suoraan tiedostoon (Chrome, Edge), poistetun projektin palautus ja muistutus tiedostokopiosta. Toimii myös ilman verkkoa (asennettava PWA).                                                                                                                                                                                 |
| **Tietotyö**               | Vaiheille työaika ja odotusaika (väli), toistuvuus, RACI, kipupisteet parannusideoineen ja tunnisteet. _Analyysi_-näkymä näyttää läpimenoajan (nopein, tyypillinen, hitain), luovutukset roolien välillä, uudelleenkierrokset, roolien kuormituksen, RACI- ja rooli × järjestelmä -matriisit sekä kipupisteet. Lämpökartta (aika, kipupisteet, luovutukset) kaaviossa, esityksessä ja vienneissä. |
| **Versiot ja tavoitetila** | Nimetyt versiot kommentteineen (palautus kumottavissa), tavoitetila nykytilan kopiona ja _Vertailu_-näkymä: lisätyt, poistetut ja muuttuneet vaiheet, roolimuutokset, yhteydet ja mittarien muutos (luovutukset, kierrokset, läpimeno, työ ja odotus) sekä kaaviot rinnakkain korostuksineen. Muutokset voi korostaa esityksessä ja vienneissä ja liittää muutosluettelona prosessidokumenttiin.  |
| **Esittäminen**            | _Esitystila_ (siisti koko ruudun näkymä, läpikäynti vaihe vaiheelta) sekä viennit: SVG, PNG, PDF, prosessidokumentti, itsenäinen HTML, Mermaid ja BPMN 2.0.                                                                                                                                                                                                                                       |

## Aloitus

```bash
npm install
npm run dev        # http://localhost:5173
```

Projektivalikosta (yläpalkin projektin nimi) löytyy **Uusi esimerkkiprojektista**, joka lataa ostolaskun käsittelyn esimerkkinä. Siinä on tarkoituksella aukkoja, joten kysymysjono on heti käytössä.

Vaatimukset: Node.js 20.19+ tai 22.12+.

## Pikasyötteen syntaksi

```
# Tilauksen käsittely
- Vastaanota tilaus @Myynti [CRM] > Tilaus
- Tarkista luottotiedot @Talous
? Ylittyykö luottoraja
  kyllä: Pyydä ennakkomaksu @Talous
  ei: jatka
- Lähetä tilausvahvistus @Myynti [Sähköposti] ~arvaus
+ Toimitus @Logistiikka
  - Keräile tuotteet [Varastojärjestelmä]
  - Lähetä paketti
```

| Merkintä                          | Merkitys                                                      |
| --------------------------------- | ------------------------------------------------------------- |
| `- Vaihe`                         | Vaihe (myös `*`, `1.`, `1)`)                                  |
| `@Rooli`, `@(Monisanainen rooli)` | Vastuurooli                                                   |
| `[CRM, ERP]`                      | Järjestelmät                                                  |
| `< Syöte`, `> Tuotos`             | Syötteet ja tuotokset                                         |
| `~arvaus`, `~vahvistettu`         | Varmuus (oletus: todennäköinen)                               |
| `? Kysymys`                       | Päätös, haarat sisennettynä `kyllä: …`                        |
| `jatka`, `loppu`, `-> Vaihe`      | Haara jatkaa, päättyy tai palaa vaiheeseen                    |
| `+ Alaprosessi`                   | Alaprosessi, sisältö sisennettynä                             |
| `alku`, `loppu`, `alku: Nimi`     | Alku- ja loppupiste (luodaan itse, jos puuttuvat)             |
| `=2 pv`, `^1-3 pv`                | Työaika ja odotusaika (min, h, pv, vk; väli tai min-tyyp-max) |
| `%viikoittain`, `#tunniste`       | Toistuvuus ja tunniste                                        |
| `!3 Ongelma => Idea`              | Kipupiste (vakavuus 1–3) ja parannusidea                      |
| `A@Rooli`, `C@Rooli`, `I@Rooli`   | RACI (`@Rooli` on suorittaja eli R)                           |
| `---`                             | Erotin: seuraava ketju ei jatka edellistä                     |
| `// kommentti`                    | Rivi ohitetaan                                                |

Samannimiset vaiheet tunnistetaan, joten tekstiä voi lisätä uudelleen tai täydentää vaiheiden tietoja ilman että syntyy kaksoiskappaleita.

## Pikanäppäimet

| Näppäin                                      | Toiminto                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `Ctrl+K`                                     | Pikasyöte auki/kiinni                                             |
| `Ctrl+Z`, `Ctrl+Shift+Z`                     | Kumoa, tee uudelleen                                              |
| `Enter`                                      | Lisää vaihe valitun jälkeen                                       |
| `↑ ↓ ← →`                                    | Liiku vaiheesta toiseen (↓↑ eteen ja taakse, ←→ haarojen välillä) |
| `Ctrl+C`, `Ctrl+V`                           | Kopioi ja liitä vaiheet (myös toiseen prosessiin)                 |
| `Ctrl+H`                                     | Etsi ja korvaa                                                    |
| `?`                                          | Pikanäppäinohje                                                   |
| `F2`, `Delete`                               | Nimeä uudelleen, poista                                           |
| `/`                                          | Hae vaiheita                                                      |
| `Esc`                                        | Tyhjennä valinta tai sulje                                        |
| Esityksessä `←`, `→`, `Space`, `+`, `-`, `0` | Läpikäynti, zoom, sovitus                                         |

## Tiedot ja yksityisyys

- Projektit tallentuvat selaimen IndexedDB:hen. Työkalu ottaa automaattisia varmuuskopioita (valikko “Tallennus ja varmuuskopiot”). **Yhdistä projekti tiedostoon** (Chrome, Edge) tai **vie se JSON-tiedostoon säännöllisesti**, koska selaimen tietojen tyhjennys poistaa selaimen sisäiset kopiot.
- Sovelluksen voi asentaa (projektivalikko → Asenna sovellus), ja se toimii ilman verkkoa. Uusi versio ilmoitetaan, eikä se tule käyttöön ennen kuin painat “Päivitä nyt”.
- Älä pidä samaa projektia auki usean välilehden kautta.
- Tuodut dokumentit käsitellään kokonaan selaimessa.
- Vientitiedostot syntyvät selaimessa; mitään ei lähetetä minnekään.

## Kehitys

```bash
npm run dev          # kehityspalvelin
npm run build        # tyyppitarkistus + tuotantobuild (dist/)
npm run typecheck    # tyyppitarkistus
npm run lint         # ESLint
npm test             # yksikkötestit (Vitest)
npm run e2e          # selaintestit (Playwright, rakentaa ja käynnistää sovelluksen)
npm run format       # Prettier
```

Jokaisen muutoksen tarkistaa CI (`.github/workflows/ci.yml`). Julkaisu GitHub Pagesiin tapahtuu `main`-haaran päivityksestä (`.github/workflows/pages.yml`).

### Rakenne

```
src/
  model/      tietomalli, operaatiot, komennot, validointi, serialisointi, esimerkit
  store/      tila (Zustand), kumoa/tee uudelleen, UI-tila, toiminnot
  storage/    IndexedDB (Dexie)
  layout/     ELK-asettelu (worker), uimaradat, hierarkkinen asettelu
  canvas/     kaavio (React Flow), solmut, reunat, kaaviomalli
  panels/     paneelit: ominaisuudet, kysymykset, lähteet, pikasyöte, vienti, esitys
  capture/    pikasyöte (jäsennin, suunnittelija), dokumenttituonti, ehdotusmoottori, viitteet
  analysis/   aukkosäännöt, valmiusaste, haku
  export/     SVG-piirtäjä, Mermaid, BPMN, dokumentti, tulostus, teemat
e2e/          selaintestit
docs/         suunnitelma ja arkkitehtuurimuistiinpanot
```

Arkkitehtuuriperiaatteet:

1. **Malli ensin, kaavio on näkymä.** Kaikki näkymät piirretään samasta rakenteisesta mallista.
2. **Jokainen muutos on operaatio.** Käsin muokkaus, tekstisyöte, dokumenteista poiminta ja kysymyksiin vastaaminen tuottavat samoja operaatioita, joten kumoaminen ja esikatselu toimivat yhdellä mekanismilla.
3. **Epävarmuus näkyy.** Jokaisella vaiheella on varmuustaso ja lähdeviitteet.
4. **Aukot lasketaan, eivät tallenneta.** Vain käyttäjän päätökset (ohitukset) tallennetaan.
5. **Yksi renderöintiketju.** Esitystila ja kaikki viennit käyttävät samaa asettelua ja SVG-piirtäjää.

Lisätietoa: [docs/suunnitelma.md](docs/suunnitelma.md).
