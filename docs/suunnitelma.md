# Suunnitelma ja toteutuksen tila

Tämä dokumentti kertoo, mitä on tehty, miksi ja mitä on jätetty tekemättä. Se on tarkoitettu luettavaksi pitkän tauon jälkeen.

## Lähtökohdat

- Työkalu on vain yhdelle käyttäjälle. Ei palvelinta, tilejä eikä ulkoista tekoälypalvelua. Data pysyy selaimessa.
- Syötteinä ovat omat muistiinpanot ja dokumentit. Tavoitteena on ensin oma ymmärrys ja sitten esittely muille.
- Poiminta tehdään paikallisilla säännöillä ja ihminen vahvistaa. Poiminta on `Extractor`-rajapinnan takana, joten paikallisen kielimallin voi lisätä myöhemmin.

## Vaiheiden tila

| #   | Vaihe                       | Tila        | Keskeiset tiedostot                                                                                 |
| --- | --------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| 0   | Perusta                     | Valmis      | `vite.config.ts`, `eslint.config.js`, `.github/workflows/`                                          |
| 1   | Datamalli ja tallennus      | Valmis      | `src/model/`, `src/store/`, `src/storage/`                                                          |
| 2   | Kaavio ja käsin muokkaus    | Valmis      | `src/canvas/`, `src/layout/`, `src/panels/Inspector.tsx`                                            |
| 3   | Pikasyöte tekstinä          | Valmis      | `src/capture/syntax.ts`, `plan.ts`, `serialize.ts`, `src/panels/QuickInput.tsx`                     |
| 4   | Dokumentit lähteinä         | Valmis      | `src/capture/importers.ts`, `suggest.ts`, `src/panels/SourcesView.tsx`                              |
| 5   | Tarkentuminen               | Valmis      | `src/analysis/`, `src/panels/QuestionsPanel.tsx`                                                    |
| 6   | Laajat prosessit            | Valmis      | `src/canvas/useCanvasModel.ts`, `src/layout/lanes.ts`, `hierarchy.ts`, `src/analysis/search.ts`     |
| 7   | Esittäminen                 | Valmis      | `src/export/`, `src/panels/PresentView.tsx`, `ExportDialog.tsx`                                     |
| 8   | Käyttöönotto ja datan turva | Valmis      | `src/storage/`, `src/store/storage.ts`, `src/panels/StorageDialog.tsx`, `build/serviceWorker.ts`    |
| 9   | Koekäyttö ja kitkan poisto  | Valmis      | `src/capture/discover.ts`, `src/capture/eval/`, `src/model/clipboard.ts`, `src/analysis/replace.ts` |
| 10  | Tietotyön rikkaampi malli   | Valmis      | `src/model/duration.ts`, `src/analysis/metrics.ts`, `src/panels/AnalysisView.tsx`, `WorkFields.tsx` |
| 11  | Nykytila ja tavoitetila     | Valmis      | `src/analysis/compare.ts`, `src/panels/CompareView.tsx`, `VersionsDialog.tsx`                       |
| 14  | Esittämisen syventäminen    | Valmis      | `src/export/deck.ts`, `pptx.ts`, `tiles.ts`, `views.ts`, `src/panels/SavedViewsDialog.tsx`          |
| 12  | Tuonnit                     | Valmis      | `src/capture/table.ts`, `diagram.ts`, `bpmnImport.ts`, `mermaidImport.ts`, `office.ts`, `ocr.ts`    |
| 13  | Paikallinen kielimalli      | Valmis osin | `src/capture/llm.ts`, `src/capture/eval/`, `src/panels/LlmPanel.tsx`, `src/store/llm.ts`            |
| 15  | Puhelin                     | Valmis      | `src/ui/useMedia.ts`, `TopBar.tsx`, `src/canvas/Canvas.tsx`, `src/App.tsx`                          |
| 16  | Tekoälytyönkulut            | Valmis      | `src/capture/aiPrompt.ts`, `aiResponse.ts`, `plan.ts`, `src/panels/AiAssist.tsx`                    |
| 17  | Dokumentin rakenne malliin  | Valmis      | `src/capture/markdown.ts`, `syntax.ts`, `src/panels/ProcessCardDialog.tsx`                          |
| 18  | Siirto laitteiden välillä   | Valmis      | `src/model/sync.ts`, `src/panels/SyncDialog.tsx`                                                    |
| 19  | Katselmointi                | Valmis      | `src/export/document.ts`, `src/model/feedback.ts`, `src/panels/SyncDialog.tsx`                      |
| 20  | Ylläpito                    | Valmis      | `.github/workflows/`, `docs/`                                                                       |

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
- Tekstintunnistus (OCR) on mitattu siistillä skannauksella. Huono kuvanlaatu tai käsinkirjoitus heikentää tulosta (vaihe 12).
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

Julkaisu: GitHub Pages -työnkulku poistettiin vaiheessa 20, koska julkaisu tehdään Vercelin kautta. Sovellus on staattinen ja polut ovat suhteellisia.

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

### Vaihe 10: Tietotyön rikkaampi malli ja analyysit (valmis)

- **Malli** (skeema 2, vanhat projektit avautuvat sellaisenaan): vaiheelle työaika ja odotusaika (`DurationRange`: min, tyypillinen, max minuutteina; päivä = 8 h, viikko = 5 päivää), toistuvuus, RACI (rooli on suorittaja R, muut roolit `raci`-kentässä), kipupisteet (vakavuus 1–3 ja parannusidea) ja tunnisteet. Roolin poisto siivoaa viitteet.
- **Syöttö.** Pikasyötteessä `=2 pv`, `^1-3 pv`, `%viikoittain`, `#tunniste`, `!3 Ongelma => Idea` ja `A@Rooli`/`C@Rooli`/`I@Rooli`; viety teksti ja takaisin tuotu teksti ovat samat (testattu), ja uudelleenlisäys on idempotentti. Ehdotusmoottori tunnistaa lähdetekstistä aikailmaisut (“kahden päivän kuluessa” on odotusaikaa), toistuvuuden ja ongelmalauseet (liitetään edelliseen vaiheeseen kipupisteeksi).
- **Analyysit** (`metrics.ts`): luovutukset roolien välillä ja niihin liittyvä odotus, läpimenoaika (nopein polku minimiarvoilla, lyhin ja pisin polku tyypillisillä arvoilla, hitain polku maksimiarvoilla, kriittinen polku, alaprosessit rekursiivisesti), uudelleenkierrokset ja yhden kierroksen kesto, roolien kuormitus. Uusi aukkosääntö: tuotos, jota mikään vaihe ei käytä syötteenä.
- **Näkymät.** Analyysi-näkymä (kortit, kriittinen polku, luovutustaulukko, kierrokset, kuormitus, muokattava RACI-matriisi, rooli × järjestelmä, kipupisteet). Lämpökartta kaaviossa (aika, kipupisteet, luovutukset) ja kestot ja kipupistemerkit vaiheissa.
- **Viennit.** Esitys ja SVG/PNG/PDF: kestot, kipupistemerkit ja lämpökartta valittavissa. Prosessidokumentti: kesto- ja odotussarakkeet, mittarit, RACI-matriisi ja kipupisteliite (vain, jos tietoja on, joten vanhat projektit tuottavat saman dokumentin kuin ennen).

Rajoitus: arviot ovat vain niin hyviä kuin annetut kestot. Päätösten haarojen todennäköisyyksiä ei mallinneta, joten läpimenoaika esitetään välinä eikä odotusarvona. Kestot ovat työaikaa, eivät kalenteriaikaa.

### Vaihe 11: Nykytila ja tavoitetila (valmis)

- **Versiot** (`Project.versions`, skeema 3) ovat nimettyjä tilannekuvia prosessin rakenteesta (prosessit, vaiheet, yhteydet, roolit ja muut entiteetit). Ne kulkevat projektin mukana JSON-viennissä, varmuuskopioissa ja tiedostoyhteydessä, ja ne ovat tavallisia operaatioita (`addVersion`, `updateVersion`, `deleteVersion`, `restoreVersion`), joten kumoaminen toimii. Palautus korvaa rakenteen, mutta säilyttää lähteet ja versiot ja siivoaa viitteet, joita ei enää ole. Vioittunut versio pudotetaan tuonnissa, eikä se estä projektin avaamista.
- **Tavoitetila** on nykytilan kopio uutena projektina. Vaiheet, yhteydet ja roolit säilyttävät tunnisteensa, joten vertailu tunnistaa ne samoiksi luotettavasti. Lähtötilanne tallentuu kopion versioksi (`baseline`), ja alkuperäinen projekti ei muutu.
- **Vertailu** (`compare.ts`): lisätyt, poistetut ja muuttuneet vaiheet kenttätasolla (nimi, tyyppi, rooli, järjestelmät, syötteet, tuotokset, kestot, RACI, kipupisteet, tunnisteet), yhteydet, prosessit, roolimuutokset sekä mittarien muutos molemmista tiloista laskettuna. Jos vaihe on luotu uudelleen samalla nimellä ja tyypillä, se tunnistetaan samaksi eikä näy poistettuna ja lisättynä.
- **Näkymät.** Vertailu-näkymässä muutosluettelo ja kaaviot rinnakkain (lisätty vihreä, poistettu punainen katkoviiva, muuttunut keltainen). Versiot ja tavoitetila löytyvät projektivalikosta.
- **Esitys ja viennit.** “Korosta muutokset lähtötilaan verrattuna” värjää vaiheet esityksessä ja kuvaviennissä, ja prosessidokumenttiin tulee muutosluettelo mittareineen.

Rajoitus: versio sisältää vain prosessin rakenteen, ei lähteitä tai kysymyksiä. Vertailu tunnistaa vaiheet tunnisteen tai nimen perusteella, joten täysin uudelleen kirjoitettu ja uudelleen nimetty vaihe näkyy poistettuna ja lisättynä.

### Vaihe 14: Esittämisen syventäminen (valmis)

- **PowerPoint-vienti** (`deck.ts` suunnittelee, `pptx.ts` kirjoittaa pptxgenjs:llä, joka ladataan vasta tarvittaessa). 16:9-diat: otsikkodia, kaaviot kuvina (vaaka- tai pystyasettelu valitaan sen mukaan, kumpi mahtuu diaan isompana), mittarit ja kipupisteet taulukkoina, muutosluettelo ja vaihe vaiheelta -läpikäyntidiat korostettuine vaiheineen sekä puhujan muistiinpanot (vaiheiden tiedot, skenaarion polku). Dioja voi valita vientiikkunassa. Tuloksen oikeellisuus testataan python-pptx:llä ja piirtyminen LibreOfficella. `pptxgenjs`:n riippuvuus `image-size` ohitetaan selainpaketissa, ja sen haavoittuvuus on korjattu `overrides`-asetuksella.
- **Tallennetut näkymät** (`Project.views`, skeema 4): prosessi, asettelu (alaprosessit auki, vain vahvistetut), kestot ja lämpökartta, muutosten korostus, valinnainen rajaus valittuihin vaiheisiin ja skenaario sekä puhujan muistiinpano. Näkymiä voi järjestää, ja esitys ja PowerPoint koostetaan niistä. Esityksessä näkymä valitaan yläpalkista.
- **Skenaariopolut** (`Project.scenarios`, `scenario.ts`): valinnat päätöksissä, esim. “luottoraja ylittyy”. Polku korostetaan ja numeroidaan kaaviossa, ja läpikäynti kulkee vain polun vaiheissa. Poistuneiden prosessien näkymät ja skenaariot siivotaan, ja vioittuneet tietueet pudotetaan tuonnissa.
- **Interaktiivinen HTML.** Haku himmentää ei-osuvat vaiheet ja suodattaa rivit, vaiheen napsautus avaa tietopaneelin (rooli, järjestelmät, kestot, kipupisteet ja niin edelleen), alaprosessiin pääsee tietopaneelin painikkeesta tai kaksoisnapsautuksella ja takaisin “Takaisin”-painikkeella. Vaiheiden tiedot ovat turvallisesti koodattuna JSON-lohkona (`<`, `>`, `&` koodattu, tekstit lisätään `textContent`-kentällä).
- **Suurten kaavioiden tulostus** (`tiles.ts`): PDF-vienti voi jakaa kuvan A4- tai A3-sivuille (vaaka tai pysty, mittakaava “sovita leveys” tai 100 %). Jokaisella sivulla on sivu- ja rivi/sarake-merkintä, ja arvio sivumäärästä näkyy valinnoissa. Sivut voi liittää yhteen isoksi seinäkaavioksi.

Rajoitus: PowerPoint-diat ovat kuvia eivätkä muokattavia muotoja. Hyvin suuri prosessi (satoja vaiheita) mahtuu yhteen diaan vain pienenä, joten ne kannattaa jakaa alaprosesseihin tai tallennettuihin rajattuihin näkymiin.

### Vaihe 12: Tuonnit olemassa olevasta materiaalista (valmis)

- **Taulukot** (`table.ts`, `ImportDialog`): Excel (.xlsx luetaan JSZipillä ilman ulkoista Excel-kirjastoa: jaetut ja sisäkkäiset merkkijonot, luvut, totuusarvot ja päivämäärät), CSV/TSV (erotin tunnistetaan, UTF-8 tai Windows-1252) ja leikepöydältä liitetty taulukko. Sarakkeet tunnistetaan otsikoista (suomi ja englanti) ja ne voi yhdistää käsin: vaihe, tyyppi, rooli, järjestelmät, syötteet, tuotokset, työaika, odotus, kuvaus, varmuus, alaprosessi (ryhmä) ja seuraava vaihe. Taulukko muunnetaan pikasyötteen tekstiksi ja avataan pikasyötteessä, joten esikatselu, nimiyhdistys ja idempotenssi toimivat kuten käsin kirjoitetulla tekstillä. Solujen sisältö ei voi tulkita itseään merkinnäksi.
- **BPMN 2.0** (`bpmnImport.ts`): tapahtumat, tehtävätyypit, yhdyskäytävät, alaprosessit, uimaradat rooleiksi, dokumentaatio kuvaukseksi ja sekvenssivirrat nimikkeineen. Nimettömät yhdistävät yhdyskäytävät sivuutetaan, useampi prosessi tuodaan alaprosesseina ja viestivirrat, dataobjektit ja reunatapahtumat jätetään pois (kerrotaan yhteenvedossa). **Mermaid** (`mermaidImport.ts`): solmumuodot, nuolinimikkeet, ketjut ja subgraph alaprosessina. Oma vienti kiertää takaisin samaksi rakenteeksi (testattu). Tuonti uutena projektina tai lisäys nykyiseen prosessiin yhtenä kumottavana erä.
- **PowerPoint ja sähköposti lähteiksi** (`office.ts`): .pptx (diat järjestyksessä, puhujan muistiinpanot mukana) ja .eml (otsikot, MIME-osat, quoted-printable ja base64, merkistöt).
- **Tekstintunnistus** (`ocr.ts`, tesseract.js): skannatut PDF:t (vain tekstittömät sivut) ja kuvat (.png, .jpg). Suomen ja englannin kielitiedot, työntekijä ja WebAssembly-ydin tulevat sovelluksen mukana (`ocr/`, noin 19 Mt, ladataan vasta käytettäessä, tallennetaan välimuistiin eikä kuulu esilatauksen piiriin), joten mitään ei lähetetä minnekään ja tunnistus toimii offline ensimmäisen käytön jälkeen. Sovellus kysyy luvan ennen tunnistusta ja näyttää edistymisen ja peruutuksen. Tulos tarkistetaan käsin, koska tunnistus voi virhetyä.

Rajoitukset: vanhat .xls, .doc, .ppt ja .msg eivät ole tuettuja (kerrotaan käyttäjälle), BPMN-tuonti ei lue suoritettavaa logiikkaa (ehtolausekkeet, skriptit) eikä Mermaidin muita kaaviotyyppejä kuin vuokaavio, ja OCR on mitattu siistillä skannauksella: huono kuvanlaatu tai käsinkirjoitus heikentää tulosta.

### Vaihe 13: Paikallinen kielimalli (valmis osin)

Tämä vaihe oli suunnitelmassa valinnainen ja ehdollinen mittaukselle. Toteutettu on infrastruktuuri ja mittari, mutta kielimallia ei ole mitattu oikealla mallilla, koska tässä ympäristössä ei ole kielimallipalvelinta. Päätös käyttöönotosta jää sinulle, ja sitä varten sovelluksessa on valmis mittari.

- **Arviointiaineisto** (`src/capture/eval/corpus.ts`): 12 suomenkielistä prosessikuvausta (proosa, luettelo, passiivi, ehtolauseet, englanninkieliset termit) odotettuine vaiheineen ja rooleineen, ja mittari (`metrics.ts`: löydetyt odotetuista, oikeiden osuus ehdotuksista ja F1). Sama mittari ajetaan sääntömoottorille ja kielimallille.
- **Sääntömoottorin parannus aineiston avulla**: lisää toimintaverbejä, roolien ja yksiköiden tunnistus yksittäisistä maininnoista (ehdotetaan valitsemattomana). Mittaustulos aineistolla: vaiheiden löytyminen 100 %, ehdotusten osuvuus 94,5 % ja roolien löytyminen 85 %. **Luvut ovat optimistisia**, koska sääntöjä on kehitetty samaa aineistoa vasten. Aineisto on tehty sääntöjen kehityksen rinnalla eikä kata sotkuista oikeaa materiaalia, joten arvioi tuloksia omilla teksteilläsi.
- **Kielimalliadapteri** (`llm.ts`): OpenAI-yhteensopiva `/v1/chat/completions` (Ollama, LM Studio, llama.cpp). Teksti pilkotaan kappalerajoilta, malli palauttaa JSON-skeeman mukaiset vaiheet (nimi, täsmällinen lainaus, rooli, järjestelmät, haara, kesto ja odotus), ja lainaus etsitään lähdetekstistä (täsmällisesti, väljästi ja lauseiden sanapäällekkäisyydellä). Ehdotus, jota ei löydy tekstistä, hylätään, jotta lähdeviite on aina luotettava. Palvelimen, joka ei tunne skeemaa, vastausmuotoa kevennetään automaattisesti.
- **Yksityisyys**: osoitteen on oletuksena oltava omalla koneella tai paikallisessa verkossa. Muulle osoitteelle sovellus varoittaa ja pyytää vahvistuksen joka ajolla. Asetukset (osoite ja malli) tallentuvat vain tähän selaimeen.
- **Käyttö** (lähdenäkymän ehdotusvälilehti): hae mallit, valitse malli, “Aja kielimallilla” tai “Mittaa aineistolla”. Mittaus näyttää dokumenteittain säännöt ja kielimallin rinnakkain sekä päätelmän. Mallin tulos ja säännöt ovat vaihdettavissa lähteen sisällä.
- **Testaus**: adapteri on testattu simuloidulla palvelimella (jäsennys, sijainnin etsintä, pilkkominen, virheet, kevennys) ja koko selainpolku Playwrightin simuloimalla OpenAI-rajapinnalla. Oikealla mallilla sitä ei ole ajettu.

Ei toteutettu: selaimessa toimiva malli (WebLLM). Se vaatisi WebGPU:n ja 2–5 Gt latauksen, eikä sitä voi varmistaa täällä, joten se jätettiin pois. Samaan rajapintaan voi ajaa myös muut paikalliset palvelimet. Huomaa myös, että selain voi pyytää lupaa paikalliseen verkkoon yhdistämiseen, kun sovellus avataan verkkosivulta (Chromen “paikallisen verkon käyttö”), ja Ollama pitää sallia selaimen pyynnöille (`OLLAMA_ORIGINS`).

## Vaiheet 15–20

Toteutusjärjestys: **15 → 16 → 17 → 18 → 19 → 20**. Lähtöoletukset (vahvistettu): puhelimella katselu, muistiinpanot, pikasyöte ja listamuokkaus; tekoäly ulkopuolisena kopioi–liitä-mallilla (käyttäjä käyttää Geminiä ja Claudea, joten ohjeet ovat yleisiä); siirto laitteiden välillä tiedostona; katselmointi HTML-tiedostolla; julkaisu Vercelillä.

### Vaihe 15: Puhelin (valmis)

- Yläpalkki yhdelle riville: harvinaisemmat toiminnot (Esitä, Vie, roolit, ominaisuudet, suunta, tallennus) ovat Lisää-valikossa kapealla näytöllä (`useNarrow`, alle 700 px).
- Kaavion haku, väritys ja asettelutapa ovat Näkymä-paneelissa, joka avautuu napista eikä peitä työkalupalkkia. Tyhjän prosessin aloituskortti täyttää kaavion ja vierittyy.
- Kosketusyhdistäminen: valitse vaihe, paina Yhdistä ja napauta kohdetta. Kahvat ovat isompia kosketuslaitteilla. Vanhaan Pikasyöte-reittiin ei koskettu.
- Sivupaneelit avautuvat sisällön päälle ja sulkeutuvat taustaa napauttamalla. Vaihetta lisätessä paneeli ei enää avaudu puhelimella (se peittäisi kaavion).
- Analyysi, vertailu, lähteet ja kaikki ikkunat ladataan vasta tarvittaessa: pääpaketti 979 → 772 kt. Yleisimmät osat ladataan valmiiksi muutaman sekunnin kuluttua, ja ne ovat offline-välimuistissa.
- Rajoitus: kaavion raahausmuokkaus ja suuret mallit ovat edelleen tietokoneelle. Puhelinkäyttöä on testattu emuloidulla 390 × 844 -näytöllä, ei oikealla laitteella.

### Vaihe 16: Tekoälytyönkulut (valmis)

- **Ohjepohjat** (`aiPrompt.ts`): muotoile muistiinpanot, arvioi nykyinen prosessi (prosessi ja avoimet kysymykset mukana), haastattelukysymykset ja esittelyteksti. Syntaksitaulukko tulee syntaksiohjeesta, ja esimerkki on testattu jäsentyväksi. Teksti näytetään ennen kopiointia.
- **Vastauksen siivous** (`aiResponse.ts`): johdanto, koodilohko, loppuselitys, lihavoinnit ja tähtiluettelot pois, palautettavissa. Markdown-dokumentti ei sekoitu tekoälyvastaukseen.
- **Nimenmuutos** `Uusi nimi (aiemmin: Vanha nimi)`: vaihe säilyy yhteyksineen, ja vanhaan nimeen viittaavat hypyt löytävät sen.
- **Poistot**: valinta _Poista vaiheet, joita tekstissä ei ole_ ehdottaa poistettavaksi vaiheet, joita koko prosessin kuvaavassa tekstissä ei ole. Jokaisen voi säilyttää erikseen, ja aukon yli siltaudutaan.
- Rajoitus: ohjeita ei ole kokeiltu oikealla tekoälyllä, vain testattu, että niiden esimerkki toimii sovelluksessa.

### Vaihe 17: Dokumentin rakenne malliin (valmis)

- **Malli** (skeemaversio 5): prosessikortti (tarkoitus, omistaja, käynnistäjä, asiakas, tuotokset, mittarit, riskit, tarkistuslista), roolin kuvaus ja vaiheen tarkistuslista.
- **Direktiivit** pikasyötteessä: `:tarkoitus`, `:omistaja`, `:asiakas`, `:käynnistäjä`, `:tuotos`, `:mittari`, `:riski`, `:tarkistus`, `:rooli Nimi: kuvaus`. Ne kulkevat mukana tekstiviennissä ja tuonnissa.
- **Markdown-muunnos** lukee roolitaulukon, RACI-taulukon (R/A/C/I-sarakkeet), vaiheiden Tavoite/Syöte/Tuotos/Toimenpiteet/Työaika/Odotus/Tarkistuslista-kentät sekä tarkistuslista-, mittari- ja riskiosiot. Mermaid-kaavion vaihe, josta lähtee useita haaroja, tulee päätökseksi.
- **Näkyvyys**: prosessikortti-ikkuna, roolin kuvaus roolinhallinnassa, vaiheen tarkistuslista ominaisuuksissa, kortti dokumenttiviennissä ja PowerPoint-esityksen alussa.
- Rajoitus: päätöksen kuvaus ei säily pikasyötteessä. Otsikottomissa dokumenteissa (esim. liitetty teksti, josta otsikot ovat hävinneet) osioita ei voi tunnistaa. Vaihetaulukot (Vaihe | Rooli | Järjestelmä) tuodaan Excelinä tai CSV:nä.

### Vaihe 18: Siirto laitteiden välillä (valmis)

- Jokaisella tietueella on muokkausaika ja poistetuilla poistomerkintä (`stamps`, `tombstones`). Ne päivitetään tallennuksen yhteydessä viitteitä vertaamalla, joten operaatiot pysyvät puhtaina. Kumoaminen ja uudelleentekeminen leimataan myös.
- **Jaa**: jakovalikko puhelimella, muuten tiedoston lataus. **Yhdistä** (`sync.ts`): kummankin laitteen lisäykset säilyvät, eroavissa tietueissa uudempi voittaa (valinnan voi vaihtaa), poistettu ja sen jälkeen muokattu säilyy, samannimiset roolit ja järjestelmät yhdistyvät, ja eheys tarkistetaan. Yhdistäminen on yksi kumottava askel.
- Rajoitus: yhdistäminen perustuu muokkausaikoihin eikä yhteiseen lähtötilaan, joten jos sama asia on muuttunut molemmilla, valinta tehdään käsin. Laitteiden kellojen erot voivat vaikuttaa oletusvalintaan. Rinnakkaiset muutokset samaan kohtaan (esim. kaksi uutta vaihetta saman vaiheen jälkeen) tuottavat rinnakkaiset haarat, jotka käyttäjä siistii.

### Vaihe 19: Katselmointi (valmis)

- **HTML-vienti palautetilassa**: lukija kommentoi vaiheita ja vastaa avoimiin kysymyksiin ja tallentaa palautteen tiedostoksi. Suoritettava skripti on kiinteä eikä sisällä käyttäjän tietoja.
- **Palautteen tuonti** (Jaa ja yhdistä): rivit valitaan, ja niistä tulee avoimia kysymyksiä oikeisiin vaiheisiin. Tuonti on idempotentti, ja toisen projektin palaute hylätään.

### Vaihe 20: Ylläpito (valmis)

- GitHub Pages -työnkulku poistettu (julkaisu Vercelillä).
- `npm audit`: ei haavoittuvuuksia. Offline-testi kattaa nyt myös vasta tarvittaessa ladattavat näkymät.
