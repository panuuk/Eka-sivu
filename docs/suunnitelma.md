# Suunnitelma ja toteutuksen tila

Tämä dokumentti kertoo, mitä on tehty, miksi ja mitä on jätetty tekemättä. Se on tarkoitettu luettavaksi pitkän tauon jälkeen.

## Lähtökohdat

- Työkalu on vain yhdelle käyttäjälle. Ei palvelinta, tilejä eikä ulkoista tekoälypalvelua. Data pysyy selaimessa.
- Syötteinä ovat omat muistiinpanot ja dokumentit. Tavoitteena on ensin oma ymmärrys ja sitten esittely muille.
- Poiminta tehdään paikallisilla säännöillä ja ihminen vahvistaa. Poiminta on `Extractor`-rajapinnan takana, joten paikallisen kielimallin voi lisätä myöhemmin.

## Vaiheiden tila

| #   | Vaihe                       | Tila         | Keskeiset tiedostot                                                                              |
| --- | --------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 0   | Perusta                     | Valmis       | `vite.config.ts`, `eslint.config.js`, `.github/workflows/`                                       |
| 1   | Datamalli ja tallennus      | Valmis       | `src/model/`, `src/store/`, `src/storage/`                                                       |
| 2   | Kaavio ja käsin muokkaus    | Valmis       | `src/canvas/`, `src/layout/`, `src/panels/Inspector.tsx`                                         |
| 3   | Pikasyöte tekstinä          | Valmis       | `src/capture/syntax.ts`, `plan.ts`, `serialize.ts`, `src/panels/QuickInput.tsx`                  |
| 4   | Dokumentit lähteinä         | Valmis       | `src/capture/importers.ts`, `suggest.ts`, `src/panels/SourcesView.tsx`                           |
| 5   | Tarkentuminen               | Valmis       | `src/analysis/`, `src/panels/QuestionsPanel.tsx`                                                 |
| 6   | Laajat prosessit            | Valmis       | `src/canvas/useCanvasModel.ts`, `src/layout/lanes.ts`, `hierarchy.ts`, `src/analysis/search.ts`  |
| 7   | Esittäminen                 | Valmis       | `src/export/`, `src/panels/PresentView.tsx`, `ExportDialog.tsx`                                  |
| 8   | Käyttöönotto ja datan turva | Valmis       | `src/storage/`, `src/store/storage.ts`, `src/panels/StorageDialog.tsx`, `build/serviceWorker.ts` |
| 9   | Koekäyttö ja kitkan poisto  | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |
| 10  | Tietotyön rikkaampi malli   | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |
| 11  | Nykytila ja tavoitetila     | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |
| 14  | Esittämisen syventäminen    | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |
| 12  | Tuonnit                     | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |
| 13  | Paikallinen kielimalli      | Ei aloitettu | Ks. “Jatkosuunnitelma”                                                                           |

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

## Jatkosuunnitelma (vaiheet 8–14)

Toteutusjärjestys: **8 → 9 → 10 → 11 → 14 → 12 → 13**. Lähtöoletukset (vahvistettu): Chrome tai Edge omalla koneella, materiaali on Wordia, PDF:ää ja Exceliä enimmäkseen suomeksi, esitys tehdään PowerPointilla, kielimalli tulee viimeisenä ja vain jos se mitattavasti auttaa, kaikki tietotyön ominaisuudet (luovutukset, ajat, RACI, kipupisteet) ovat tärkeitä.

### Vaihe 8: Käyttöönotto ja datan turva (valmis)

- **Offline-sovellus (PWA).** `build/serviceWorker.ts` tuottaa koontiin `sw.js`:n, joka esilataa kaikki tiedostot. Uusi versio odottaa, kunnes käyttäjä painaa “Päivitä nyt”: tallennus tehdään ensin, joten kesken oleva työ ei katkea. Asennus tarjotaan projektivalikossa.
- **Varmuuskopiot.** Automaattinen kopio vähintään 10 minuutin välein muutosten jälkeen (uusimmat 20 ja jokaisen viimeisen 14 päivän uusin säilyvät), käsin otettavat kopiot, ja poistetun projektin viimeinen tila säilyy. Palautus ottaa nykyisen tilan ensin talteen. Valinta “Avaa kopiona” ei koske alkuperäiseen.
- **Tallennus tiedostoon** (File System Access API, Chrome ja Edge). Yhdistetty tiedosto päivittyy jokaisen tallennuksen jälkeen. Jos selain vaatii luvan uudelleen, se näkyy varoituksena ja yhden klikkauksen palautuksena. Muissa selaimissa tilalla on JSON-lataus.
- **Muistutus.** Jos tiedostokopiota ei ole otettu yli viikkoon ja projektia on muokattu, työkalu muistuttaa (voi siirtää viikolla).
- **Pysyvä tallennus** pyydetään selaimelta ensimmäisen muutoksen jälkeen, ja tallennustilan käyttö näkyy.
- **Kaatumissuoja.** Koko sovelluksen virhetilassa voi viedä projektin JSON-tiedostoon tai avata viimeisimmän varmuuskopion. Yksittäisen näkymän virhe ei kaada koko sovellusta. Odottamattomat asynkroniset virheet näkyvät ilmoituksena.
- **Toinen välilehti.** Jos sovellus on auki useassa välilehdessä, siitä varoitetaan, koska ne ylikirjoittaisivat toistensa muutoksia.
- **CI** ajaa nyt myös selaintestit.

Rajoitus: GitHub Pages pitää kytkeä päälle repon asetuksista (Settings → Pages → Source: GitHub Actions) ennen kuin julkaisu onnistuu.

### Vaihe 9: Koekäyttö ja kitkan poisto (valmis)

Oikeaa prosessiasi ei ollut käytettävissä, joten kitka mitattiin realistisella suomenkielisellä rekrytointikuvauksella (`src/capture/eval/rekrytointi.ts`, 7 kappaletta ja 8 roolia ja järjestelmää, 32 odotettua vaihetta + 9 hienojakoisempaa). Aineisto toimii myös sääntömoottorin arviointiaineistona: `eval.test.ts` vaatii recall ≥ 90 % ja precision ≥ 85 %.

| Mittari                             | Ennen                             | Nyt                                                                                |
| ----------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Vaiheiden löytyminen (recall)       | 75 %                              | 98 %                                                                               |
| Ehdotusten osuvuus (precision)      | ei mitattu                        | 95 %                                                                               |
| Roolit vaiheilla                    | käsin jokaiselle vaiheelle        | löydetyt roolit yhdellä klikkauksella, > 70 % vaiheista saa roolin automaattisesti |
| Toimenpiteitä dokumentista kaavioon | tuonti + lisää kaikki + n × rooli | 4: tuo, lisää löydetyt roolit, lisää kaikki, katso (e2e mittaa ~0,5 s)             |

Mitä muutettiin:

- **Roolien ja järjestelmien löytäminen tekstistä** (`discover.ts`): subjektit toimintaverbin edestä, roolisanat taivutusmuodoissa ja järjestelmät (-järjestelmä, -systeemi jne.). Löydöt näytetään valintalistana ennen ehdotuksia, jolloin ehdotukset saavat roolinsa ja järjestelmänsä.
- **Yhdistettyjen lauseiden pilkkominen** (“A ja B” → kaksi vaihetta, jälkimmäinen perii roolin), “kun”-lauseet ajankohtana eivätkä päätöksinä, ja vaiheen nimestä pudotetaan rooli ja johdantofraasit (“Haastattelun jälkeen …”).
- **Nuolinäppäinnavigointi**, **kopioi ja liitä** vaiheet prosessien välillä, **joukkomuokkaus** (rooli, järjestelmä, varmuus usealle vaiheelle), **etsi ja korvaa** esikatselulla, **sumea kaksoisvaiheiden tunnistus** (“Tarkista lasku” ja “Laskun tarkistus”) sekä aloitusohje ja pikanäppäinohje.
- Pitkä ketju avautuu alusta luettavalla zoomilla eikä koko kuvaan kutistettuna.

Jätettiin tekemättä: solmujen käsin siirto uimaradoissa (vaatii oman raidoille sidotun asettelun, jää tunnetuksi rajoitukseksi). Palaan tähän, jos oikea käyttö osoittaa sen tarpeelliseksi.
