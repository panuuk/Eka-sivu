# Suunnitelma ja toteutuksen tila

Tämä dokumentti kertoo, mitä on tehty, miksi ja mitä on jätetty tekemättä. Se on tarkoitettu luettavaksi pitkän tauon jälkeen.

## Lähtökohdat

- Työkalu on vain yhdelle käyttäjälle. Ei palvelinta, tilejä eikä ulkoista tekoälypalvelua. Data pysyy selaimessa.
- Syötteinä ovat omat muistiinpanot ja dokumentit. Tavoitteena on ensin oma ymmärrys ja sitten esittely muille.
- Poiminta tehdään paikallisilla säännöillä ja ihminen vahvistaa. Poiminta on `Extractor`-rajapinnan takana, joten paikallisen kielimallin voi lisätä myöhemmin.

## Vaiheiden tila

| #   | Vaihe                    | Tila         | Keskeiset tiedostot                                                                             |
| --- | ------------------------ | ------------ | ----------------------------------------------------------------------------------------------- |
| 0   | Perusta                  | Valmis       | `vite.config.ts`, `eslint.config.js`, `.github/workflows/`                                      |
| 1   | Datamalli ja tallennus   | Valmis       | `src/model/`, `src/store/`, `src/storage/`                                                      |
| 2   | Kaavio ja käsin muokkaus | Valmis       | `src/canvas/`, `src/layout/`, `src/panels/Inspector.tsx`                                        |
| 3   | Pikasyöte tekstinä       | Valmis       | `src/capture/syntax.ts`, `plan.ts`, `serialize.ts`, `src/panels/QuickInput.tsx`                 |
| 4   | Dokumentit lähteinä      | Valmis       | `src/capture/importers.ts`, `suggest.ts`, `src/panels/SourcesView.tsx`                          |
| 5   | Tarkentuminen            | Valmis       | `src/analysis/`, `src/panels/QuestionsPanel.tsx`                                                |
| 6   | Laajat prosessit         | Valmis       | `src/canvas/useCanvasModel.ts`, `src/layout/lanes.ts`, `hierarchy.ts`, `src/analysis/search.ts` |
| 7   | Esittäminen              | Valmis       | `src/export/`, `src/panels/PresentView.tsx`, `ExportDialog.tsx`                                 |
| 8   | Jatkokehitys             | Ei aloitettu | Ks. alla                                                                                        |

## Poikkeamat alkuperäisestä suunnitelmasta

- **Kumoaminen** tehdään tilannekuvilla (immutable-rakenteet jakavat muistin), ei käänteisoperaatioilla. Operaatiot ovat silti dataa, joten ne ovat edelleen sarjallistettavia ja esikatseltavissa.
- **Aukot lasketaan, ei tallenneta.** Alkuperäinen suunnitelma synkronoi generoidut kysymykset malliin joka muutoksella. Nyt vain käyttäjän päätökset (ohitukset ja omat kysymykset) tallennetaan. Näin ei synny kaksoistilaa eikä kumoamisongelmia.
- **Esikatselun rivikohtainen hylkäys** pikasyötössä toteutettiin rivien ohituksena, jolloin hylätyn rivin alipuu jää pois ja yhteydet kulkevat sen yli.
- **PDF** tehdään selaimen tulostusikkunalla (“Tallenna PDF:ksi”), ei erillisellä PDF-kirjastolla. Tulos on vektorigrafiikkaa ja teksti on valittavissa.
- **Esitys ja viennit käyttävät omaa SVG-piirtäjää** (`src/export/svg.ts`), eivät kaavion DOM-kaappausta. Siksi “mitä näet on mitä viet” ja viennit toimivat myös ilman näkyvää kaaviota.

## Tärkeimmät suunnittelupäätökset

1. **Idempotenssi.** Saman pikasyötetekstin lisääminen uudelleen ei muuta mitään (testattu). Se perustuu nimitäsmäykseen ja siihen, että teksti, jonka ensimmäinen vaihe löytyy jo, ei liity liitoskohtaan.
2. **Operaatiot ovat atomisia.** `batch` tekee kaiken tai ei mitään, joten virheellinen syöte ei jätä mallia puoliksi muutetuksi.
3. **Suorituskyky.** Kaavio on täysin ohjattu (React Flow ei omista solmutilaa), olioiden viitteet pidetään vakaina, aukkoanalyysi on lineaarinen ja ajetaan matalalla prioriteetilla. Mitattu: 590 solmun mallilla kirjoitus ~22 ms/näppäin kaikissa asettelutiloissa.
4. **Turvallisuus.** Kaikki käyttäjän tekstit escapetaan SVG:ssä, HTML:ssä ja XML:ssä (testattu injektioyrityksillä). Teemavärit sanitoidaan.

## Tunnetut rajoitukset

- Ehdotusmoottori on sääntöpohjainen ja suomenkielinen. Se löytää tyypilliset prosessikuvaukset, mutta ei ymmärrä merkitystä. Ehdotukset ovat aina vain ehdotuksia.
- Dokumenttituonti ei tee tekstintunnistusta (OCR): kuvapohjaisesta PDF:stä ei löydy tekstiä.
- Uimaradoissa ja kokonaiskuvassa asettelu on automaattinen eikä solmuja voi siirtää käsin.
- BPMN-vienti sisältää rakenteen ja diagrammin, mutta ei suoritettavaa logiikkaa (esim. ehtolausekkeita).
- Selaimen tallennus voi kadota tietojen tyhjennyksessä, joten JSON-vienti on tärkeä varmuuskopio.

## Mahdollinen jatkokehitys (vaihe 8)

- Versiot ja vertailu (nykytila ja tavoitetila rinnakkain)
- Asennettava offline-sovellus (PWA)
- Tallennus suoraan tiedostoon (File System Access API)
- Paikallinen kielimallipoimija (WebLLM tai Ollama) `Extractor`-rajapinnan taakse
- Käsin siirrettävät solmut uimaradoissa
