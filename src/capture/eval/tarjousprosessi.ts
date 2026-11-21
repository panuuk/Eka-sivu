/** Oikea, sotkuinen prosessikuvaus: Mermaid-kaavio, roolitaulukko ja lihavoitua tekstiä. Vain regressiotesteihin. */
export const TARJOUSPROSESSI_TEKSTI = `# Päätason prosessi
alku
- Tämä dokumentti kuvaa tyypillisen B2B-tarjousprosessin vaiheet, vastuut ja laadunvarmistuskäytännöt tarjouspyynnön (RFP/RFQ/RFI) vastaanottamisesta valmiin tarjouksen lähettämiseen saakka.
- \`\`\`mermaid
- flowchart TD
  A[1. Vastaanotto ja kirjaaminen] --> B[2. Analysointi ja Go / No-Go]
  B -->|No-Go| C[Kohtelias kieltäytyminen ja arkistointi]
  B -->|Go| D[3. Suunnittelu ja lisäkysymykset]
  D --> E[4. Ratkaisu ja työmääräarvio]
  E --> F[5. Hinnoittelu ja ehdot]
  F --> G[6. Tarjousdokumentaation laatiminen]
  G --> H[7. Sisäinen tarkistus ja hyväksyntä]
  H -->|Korjattavaa| G
  H -->|Hyväksytty| I[8. Viimeistely ja lähettäminen]
- \`\`\`
- | Rooli | Keskeinen vastuu |
- | :--- | :--- |
- | **Myyjä / Asiakkuusvastaava** | Asiakasyhteys, tarjouspyynnön vastaanotto, kaupallinen kulma ja tarjouksen lähettäminen. |
- | **Tarjouspäällikkö (Bid Manager)** | Aikataulutus, tehtävien koordinointi, dokumentaation kokoaminen ja prosessin etenemisen varmistaminen. |
- | **Asiantuntija / Ratkaisuarkkitehti** | Vaatimusten tulkinta, teknisen tai sisällöllisen ratkaisun suunnittelu, rajaukset ja työmääräarvio. |
- | **Talous / Hinnoitteluvastaava** | Kustannuslaskenta, katelaskelmat ja hinnoittelurakenteen tarkistus. |
- | **Juridiikka / Sopimusvastaava** | Sopimusehtojen, vastuurajausten, tietosuojan ja muiden juridisten riskien arviointi. |
- | **Johto / Hyväksyjä** | Go / No-Go -päätös (suurissa hankkeissa) sekä lopullisen hinnoittelun ja riskitason hyväksyntä. |
---
- **Tavoite:** Varmistaa, että tarjouspyyntö rekisteröidään viipymättä eikä määräaikoja menetetä.
- **Toimenpiteet:**
  Vastaanota tarjouspyyntö (sähköposti, hankintaportaali tai tapaaminen) ja tallenna kaikki liitteet keskitettyyn työtilaan.
  Kirjaa myyntimahdollisuus CRM-järjestelmään (asiakas, kuvaus, arvioitu arvo, kysymysten ja tarjouksen jättöpäivät).
- **Tuotos:** CRM-kirjaus, kansiorakenne ja vastuuhenkilö.
- **Tavoite:** Arvioida, onko tarjouksen tekeminen liiketoiminnallisesti järkevää ja realistista.
- **Päätös:**
  **Go:** Edetään vaiheeseen 3.
  **No-Go:** Ilmoitetaan asiakkaalle kohteliaasti kieltäytymisestä, kirjataan perustelut CRM:ään ja suljetaan prosessi.
loppu
---
- Uusi vaihe
`
