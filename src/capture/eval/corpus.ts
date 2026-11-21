import { REKRYTOINTI_GOLD, REKRYTOINTI_TEKSTI } from './rekrytointi'

/**
 * Arviointiaineisto: suomenkielisiä prosessikuvauksia eri tyyleillä (proosa, luettelo, passiivi,
 * ehtolauseet, englanninkieliset termit) ja niistä odotetut vaiheet. Aineistolla mitataan sääntömoottoria
 * ja kielimallia samalla mittarilla, jotta valinta tehdään mittauksen eikä mutu-tuntuman perusteella.
 */

export interface GoldStep {
  /** Vaiheen kuvaus ihmiselle. */
  name: string
  /** Kaikkien näiden (pienillä kirjaimilla) pitää esiintyä ehdotuksen nimessä tai lainauksessa. */
  keys: string[]
  kind?: 'step' | 'decision'
}

export interface EvalDoc {
  id: string
  title: string
  text: string
  gold: GoldStep[]
  /** Tekstistä löytyvät roolit (perusmuodossa, pienillä kirjaimilla). */
  roles: string[]
}

export const CORPUS: EvalDoc[] = [
  {
    id: 'rekrytointi',
    title: 'Rekrytointi',
    text: REKRYTOINTI_TEKSTI,
    gold: REKRYTOINTI_GOLD,
    roles: ['esimies', 'hr-asiantuntija', 'talousjohtaja', 'it-tuki', 'palkka-asiantuntija'],
  },
  {
    id: 'ostolasku',
    title: 'Ostolaskun käsittely',
    text: `Ostolaskun käsittely

1. Lasku saapuu verkkolaskuoperaattorilta ostoreskontraan.
2. Ostoreskontra tarkistaa laskun tiedot ERP-järjestelmästä ja vertaa sitä ostotilaukseen.
3. Jos tiedot eivät täsmää, laskuttajalle lähetetään korjauspyyntö ja lasku jää odottamaan korjausta.
4. Täsmäävä lasku lähetetään esimiehelle hyväksyttäväksi.
5. Esimies hyväksyy laskun kahden päivän kuluessa tai hylkää sen perustellusti.
6. Hyväksytty lasku kirjataan kirjanpitoon ja viedään maksuun.
7. Maksuaineisto lähetetään pankkiin viikoittain.`,
    gold: [
      { name: 'Vastaanota lasku', keys: ['lasku saapuu'] },
      { name: 'Tarkista laskun tiedot', keys: ['tarkistaa', 'laskun tiedot'] },
      { name: 'Vertaa ostotilaukseen', keys: ['vertaa', 'ostotilauk'] },
      { name: 'Tiedot täsmäävät', keys: ['tiedot eivät täsmää'], kind: 'decision' },
      { name: 'Lähetä korjauspyyntö', keys: ['korjauspyyntö'] },
      { name: 'Lähetä esimiehelle', keys: ['lähetetään', 'esimiehelle'] },
      { name: 'Hyväksy lasku', keys: ['hyväksyy', 'laskun'] },
      { name: 'Hylkää lasku', keys: ['hylkää'] },
      { name: 'Kirjaa kirjanpitoon', keys: ['kirjataan', 'kirjanpito'] },
      { name: 'Vie maksuun', keys: ['viedään', 'maksuun'] },
      { name: 'Lähetä maksuaineisto pankkiin', keys: ['maksuaineisto', 'pankkiin'] },
    ],
    roles: ['ostoreskontra', 'esimies'],
  },
  {
    id: 'reklamaatio',
    title: 'Asiakasreklamaatio',
    text: `Asiakasreklamaation käsittely

Asiakaspalvelu vastaanottaa reklamaation puhelimitse, sähköpostilla tai verkkolomakkeella ja kirjaa sen CRM-järjestelmään. Kirjauksen yhteydessä asiakkaalle lähetetään automaattinen vastaanottovahvistus. Laatuvastaava arvioi reklamaation vakavuuden samana päivänä. Jos kyseessä on turvallisuusriski, tuotteen toimitukset keskeytetään välittömästi ja tuotantojohtaja ilmoitetaan asiasta.

Tavallisessa reklamaatiossa laatuvastaava pyytää asiakkaalta tarvittaessa lisätietoja ja valokuvia. Tuotanto selvittää syyn ja kirjaa havainnot raporttiin viiden työpäivän kuluessa. Jos virhe todetaan tuotannon aiheuttamaksi, asiakkaalle tarjotaan korvaava tuote tai hyvitys. Asiakaspalvelu ilmoittaa ratkaisusta asiakkaalle ja sulkee reklamaation. Lopuksi laatuvastaava päivittää virhetilaston.`,
    gold: [
      { name: 'Vastaanota reklamaatio', keys: ['vastaanottaa', 'reklamaation'] },
      { name: 'Kirjaa CRM:ään', keys: ['kirjaa', 'crm'] },
      { name: 'Lähetä vahvistus', keys: ['vastaanottovahvistus'] },
      { name: 'Arvioi vakavuus', keys: ['arvioi', 'vakavuuden'] },
      { name: 'Turvallisuusriski', keys: ['turvallisuusriski'], kind: 'decision' },
      { name: 'Keskeytä toimitukset', keys: ['keskeytetään'] },
      { name: 'Ilmoita tuotantojohtajalle', keys: ['tuotantojohtaja', 'ilmoitetaan'] },
      { name: 'Pyydä lisätietoja', keys: ['pyytää', 'lisätietoja'] },
      { name: 'Selvitä syy', keys: ['selvittää', 'syyn'] },
      { name: 'Kirjaa havainnot', keys: ['kirjaa', 'havainnot'] },
      { name: 'Tarjoa korvaus', keys: ['tarjotaan', 'korvaava'] },
      { name: 'Ilmoita ratkaisusta', keys: ['ilmoittaa', 'ratkaisusta'] },
      { name: 'Sulje reklamaatio', keys: ['sulkee', 'reklamaation'] },
      { name: 'Päivitä virhetilasto', keys: ['päivittää', 'virhetilaston'] },
    ],
    roles: ['asiakaspalvelu', 'laatuvastaava', 'tuotantojohtaja', 'tuotanto'],
  },
  {
    id: 'matkalasku',
    title: 'Matkalasku',
    text: `Matkalaskun käsittely

- Työntekijä täyttää matkalaskun Visma-järjestelmässä matkan päätyttyä.
- Työntekijä liittää kuitit skannattuina laskun liitteiksi.
- Esimies tarkistaa laskun ja hyväksyy sen.
- Jos kuitit puuttuvat, esimies palauttaa laskun korjattavaksi.
- Palkka-asiantuntija tarkistaa päivärahat ja kilometrikorvaukset.
- Palkka-asiantuntija maksaa korvaukset seuraavan palkanmaksun yhteydessä.
- Talous seuraa kuukausittain matkakulujen budjettia.`,
    gold: [
      { name: 'Täytä matkalasku', keys: ['täyttää', 'matkalaskun'] },
      { name: 'Liitä kuitit', keys: ['liittää', 'kuitit'] },
      { name: 'Tarkista lasku', keys: ['esimies tarkistaa', 'laskun'] },
      { name: 'Hyväksy lasku', keys: ['hyväksyy'] },
      { name: 'Kuitit puuttuvat', keys: ['kuitit puuttuvat'], kind: 'decision' },
      { name: 'Palauta korjattavaksi', keys: ['palauttaa', 'korjattavaksi'] },
      { name: 'Tarkista päivärahat', keys: ['tarkistaa', 'päivärahat'] },
      { name: 'Maksa korvaukset', keys: ['maksaa', 'korvaukset'] },
      { name: 'Seuraa budjettia', keys: ['seuraa', 'budjettia'] },
    ],
    roles: ['työntekijä', 'esimies', 'palkka-asiantuntija', 'talous'],
  },
  {
    id: 'hairio',
    title: 'IT-häiriönhallinta',
    text: `Häiriöiden käsittely

Käyttäjä ilmoittaa häiriöstä palvelupisteeseen puhelimella tai Palvelutori-portaalissa. Palvelupiste kirjaa häiriön ja luokittelee sen kiireellisyyden mukaan. Kriittinen häiriö eskaloidaan välittömästi päivystäjälle, ja päivystäjä ottaa yhteyttä käyttäjään 15 minuutin kuluessa. Muut häiriöt ohjataan oikealle asiantuntijaryhmälle.

Asiantuntija selvittää syyn ja korjaa vian. Jos korjaus vaatii muutoksen tuotantoympäristöön, asiantuntija tekee muutospyynnön. Korjauksen jälkeen asiantuntija testaa toimivuuden käyttäjän kanssa. Kun käyttäjä vahvistaa ongelman ratkenneen, palvelupiste sulkee tiketin. Päivystäjä kirjoittaa jälkikäteen raportin jokaisesta kriittisestä häiriöstä.`,
    gold: [
      { name: 'Ilmoita häiriö', keys: ['ilmoittaa', 'häiriöstä'] },
      { name: 'Kirjaa häiriö', keys: ['kirjaa', 'häiriön'] },
      { name: 'Luokittele kiireellisyys', keys: ['luokittelee'] },
      { name: 'Kriittinen häiriö', keys: ['kriittinen häiriö'], kind: 'decision' },
      { name: 'Eskaloi päivystäjälle', keys: ['eskaloidaan'] },
      { name: 'Ota yhteyttä käyttäjään', keys: ['ottaa yhteyttä'] },
      { name: 'Ohjaa asiantuntijalle', keys: ['ohjataan', 'asiantuntijaryhmälle'] },
      { name: 'Selvitä syy', keys: ['selvittää', 'syyn'] },
      { name: 'Korjaa vika', keys: ['korjaa', 'vian'] },
      { name: 'Tee muutospyyntö', keys: ['muutospyynnön'] },
      { name: 'Testaa toimivuus', keys: ['testaa', 'toimivuuden'] },
      { name: 'Sulje tiketti', keys: ['sulkee', 'tiketin'] },
      { name: 'Kirjoita raportti', keys: ['kirjoittaa', 'raportin'] },
    ],
    roles: ['käyttäjä', 'palvelupiste', 'päivystäjä', 'asiantuntija'],
  },
  {
    id: 'perehdytys',
    title: 'Perehdytys',
    text: `Uuden työntekijän perehdytys

Esimies tilaa uudelle työntekijälle työvälineet ja käyttöoikeudet vähintään kaksi viikkoa ennen aloituspäivää. IT-tuki asentaa kannettavan tietokoneen ja luo sähköpostitunnuksen. HR lähettää työntekijälle tervetuloviestin ja ohjeet ensimmäistä päivää varten.

Ensimmäisenä päivänä esimies esittelee työntekijän tiimille ja käy läpi viikon ohjelman. Työntekijä suorittaa tietoturvakoulutuksen verkossa ensimmäisen viikon aikana. Nimetty perehdyttäjä opastaa työntekijää päivittäisissä tehtävissä kuukauden ajan. Esimies keskustelee työntekijän kanssa kolmen kuukauden kohdalla ja kirjaa palautteen HR-järjestelmään.`,
    gold: [
      { name: 'Tilaa työvälineet', keys: ['tilaa', 'työvälineet'] },
      { name: 'Asenna tietokone', keys: ['asentaa', 'tietokoneen'] },
      { name: 'Luo sähköpostitunnus', keys: ['luo', 'sähköpostitunnuksen'] },
      { name: 'Lähetä tervetuloviesti', keys: ['lähettää', 'tervetuloviestin'] },
      { name: 'Esittele tiimille', keys: ['esittelee', 'tiimille'] },
      { name: 'Käy läpi viikon ohjelma', keys: ['käy läpi'] },
      { name: 'Suorita tietoturvakoulutus', keys: ['suorittaa', 'tietoturvakoulutuksen'] },
      { name: 'Opasta päivittäisissä tehtävissä', keys: ['opastaa'] },
      { name: 'Keskustele ja kirjaa palaute', keys: ['kirjaa', 'palautteen'] },
    ],
    roles: ['esimies', 'it-tuki', 'hr', 'työntekijä', 'perehdyttäjä'],
  },
  {
    id: 'tarjous',
    title: 'Tarjouksen laadinta',
    text: `Tarjouksen laadinta

Myyntipäällikkö vastaanottaa tarjouspyynnön ja kirjaa sen myyntijärjestelmään. Myyntipäällikkö arvioi, onko pyyntö yrityksen strategian mukainen. Jos ei ole, hän kieltäytyy kohteliaasti ja ilmoittaa asiakkaalle perusteet. Muuten myyntipäällikkö kerää tiedot tuotannolta ja logistiikalta.

Tuotanto laskee valmistuskustannukset ja logistiikka arvioi toimituskulut. Myyntipäällikkö laatii hinnoittelun ja tarjousluonnoksen. Jos tarjouksen arvo ylittää 50 000 euroa, johtoryhmä hyväksyy sen ennen lähettämistä. Myyntipäällikkö lähettää tarjouksen asiakkaalle ja soittaa asiakkaalle viikon kuluttua seurantapuhelun. Voitetut tarjoukset siirretään tilausten käsittelyyn.`,
    gold: [
      { name: 'Vastaanota tarjouspyyntö', keys: ['vastaanottaa', 'tarjouspyynnön'] },
      { name: 'Kirjaa myyntijärjestelmään', keys: ['kirjaa', 'myyntijärjestelmään'] },
      { name: 'Arvioi strategian mukaisuus', keys: ['arvioi'] },
      { name: 'Kieltäydy', keys: ['kieltäytyy'] },
      { name: 'Ilmoita asiakkaalle perusteet', keys: ['ilmoittaa', 'perusteet'] },
      { name: 'Kerää tiedot', keys: ['kerää', 'tiedot'] },
      { name: 'Laske valmistuskustannukset', keys: ['laskee', 'valmistuskustannukset'] },
      { name: 'Arvioi toimituskulut', keys: ['arvioi', 'toimituskulut'] },
      { name: 'Laadi hinnoittelu', keys: ['laatii', 'hinnoittelun'] },
      { name: 'Hyväksy johtoryhmässä', keys: ['johtoryhmä', 'hyväksyy'] },
      { name: 'Lähetä tarjous', keys: ['lähettää', 'tarjouksen'] },
      { name: 'Soita seurantapuhelu', keys: ['soittaa', 'seurantapuhelun'] },
      { name: 'Siirrä tilausten käsittelyyn', keys: ['siirretään', 'tilausten käsittelyyn'] },
    ],
    roles: ['myyntipäällikkö', 'tuotanto', 'logistiikka', 'johtoryhmä'],
  },
  {
    id: 'muutos',
    title: 'Muutoshallinta',
    text: `Muutosten hallinta

Muutoksen tekijä kirjaa muutospyynnön Jira-järjestelmään ja kuvaa muutoksen vaikutukset sekä paluusuunnitelman. Muutosvastaava arvioi muutoksen riskin ja luokittelee sen vakioksi, normaaliksi tai kiireelliseksi muutokseksi. Vakiomuutokset hyväksytään automaattisesti.

Normaalit muutokset käsittelee muutoslautakunta viikoittaisessa kokouksessa. Lautakunta hyväksyy, hylkää tai palauttaa muutoksen täydennettäväksi. Hyväksytty muutos ajoitetaan huoltoikkunaan. Muutoksen tekijä toteuttaa muutoksen ja testaa sen. Jos testi epäonnistuu, muutos perutaan paluusuunnitelman mukaisesti. Onnistuneen muutoksen jälkeen muutosvastaava sulkee pyynnön ja päivittää konfiguraatiotietokannan.`,
    gold: [
      { name: 'Kirjaa muutospyyntö', keys: ['kirjaa', 'muutospyynnön'] },
      { name: 'Kuvaa vaikutukset', keys: ['kuvaa', 'vaikutukset'] },
      { name: 'Arvioi riski', keys: ['arvioi', 'riskin'] },
      { name: 'Luokittele muutos', keys: ['luokittelee'] },
      { name: 'Hyväksy vakiomuutokset', keys: ['hyväksytään', 'automaattisesti'] },
      { name: 'Käsittele lautakunnassa', keys: ['muutoslautakunta'] },
      { name: 'Hyväksy muutos', keys: ['hyväksyy'] },
      { name: 'Hylkää muutos', keys: ['hylkää'] },
      { name: 'Ajoita huoltoikkunaan', keys: ['ajoitetaan'] },
      { name: 'Toteuta muutos', keys: ['toteuttaa'] },
      { name: 'Testaa muutos', keys: ['testaa'] },
      { name: 'Testi epäonnistuu', keys: ['testi epäonnistuu'], kind: 'decision' },
      { name: 'Peru muutos', keys: ['perutaan'] },
      { name: 'Sulje pyyntö', keys: ['sulkee', 'pyynnön'] },
      { name: 'Päivitä konfiguraatiotietokanta', keys: ['päivittää', 'konfiguraatiotietokannan'] },
    ],
    roles: ['muutoksen tekijä', 'muutosvastaava', 'muutoslautakunta'],
  },
  {
    id: 'loma',
    title: 'Lomahakemus',
    text: `Lomahakemuksen käsittely

Työntekijä hakee lomaa Lomat-järjestelmässä vähintään kaksi viikkoa etukäteen. Esimies tarkistaa tiimin kalenterin ja varmistaa, että tehtävät on hoidettu loman aikana. Jos tiimistä on jo kaksi henkilöä poissa, esimies ehdottaa vaihtoehtoista ajankohtaa. Muuten esimies hyväksyy hakemuksen. Järjestelmä lähettää työntekijälle ilmoituksen päätöksestä ja päivittää tiimin kalenterin.`,
    gold: [
      { name: 'Hae lomaa', keys: ['hakee', 'lomaa'] },
      { name: 'Tarkista kalenteri', keys: ['tarkistaa', 'kalenterin'] },
      { name: 'Varmista sijaisuudet', keys: ['varmistaa'] },
      { name: 'Kaksi poissa', keys: ['kaksi henkilöä'], kind: 'decision' },
      { name: 'Ehdota toista ajankohtaa', keys: ['ehdottaa', 'ajankohtaa'] },
      { name: 'Hyväksy hakemus', keys: ['hyväksyy', 'hakemuksen'] },
      { name: 'Lähetä ilmoitus', keys: ['lähettää', 'ilmoituksen'] },
      { name: 'Päivitä kalenteri', keys: ['päivittää', 'kalenterin'] },
    ],
    roles: ['työntekijä', 'esimies'],
  },
  {
    id: 'julkaisu',
    title: 'Ohjelmistojulkaisu',
    text: `Julkaisuprosessi

Kehittäjä avaa pull requestin, kun toiminnallisuus on valmis. Kaksi kehittäjää tekee koodikatselmoinnin, ja CI-putki ajaa automaattiset testit. Jos testit epäonnistuvat, kehittäjä korjaa virheet ja ajaa putken uudelleen. Hyväksytty muutos yhdistetään main-haaraan.

Julkaisuvastaava kokoaa release-version ja ajaa sen testiympäristöön. QA testaa version manuaalisesti ja kirjaa löydökset. Kriittiset virheet estävät julkaisun. Kun QA hyväksyy version, julkaisuvastaava julkaisee sen tuotantoon sinivihreällä julkaisulla ja seuraa metriikoita tunnin ajan. Tuotekehityspäällikkö tiedottaa julkaisusta asiakkaille julkaisutiedotteella.`,
    gold: [
      { name: 'Avaa pull request', keys: ['avaa', 'pull requestin'] },
      { name: 'Tee koodikatselmointi', keys: ['koodikatselmoinnin'] },
      { name: 'Aja automaattiset testit', keys: ['ajaa', 'automaattiset testit'] },
      { name: 'Testit epäonnistuvat', keys: ['testit epäonnistuvat'], kind: 'decision' },
      { name: 'Korjaa virheet', keys: ['korjaa', 'virheet'] },
      { name: 'Yhdistä main-haaraan', keys: ['yhdistetään', 'main'] },
      { name: 'Kokoa release', keys: ['kokoaa', 'release'] },
      { name: 'Aja testiympäristöön', keys: ['testiympäristöön'] },
      { name: 'Testaa manuaalisesti', keys: ['testaa', 'manuaalisesti'] },
      { name: 'Julkaise tuotantoon', keys: ['julkaisee', 'tuotantoon'] },
      { name: 'Seuraa metriikoita', keys: ['seuraa', 'metriikoita'] },
      { name: 'Tiedota asiakkaille', keys: ['tiedottaa', 'asiakkaille'] },
    ],
    roles: ['kehittäjä', 'julkaisuvastaava', 'qa', 'tuotekehityspäällikkö'],
  },
  {
    id: 'hankinta',
    title: 'Hankintapyyntö',
    text: `Hankintojen käsittely

Tarvitsija täyttää hankintapyynnön hankintajärjestelmässä ja perustelee hankinnan tarpeen. Budjettivastaava tarkistaa, että hankinnalle on katetta. Alle 1 000 euron hankinnat hyväksyy lähiesimies. Sitä suuremmat hankinnat hyväksyy talousjohtaja.

Hankintapäällikkö pyytää tarjoukset vähintään kolmelta toimittajalta, kun hankinnan arvo ylittää 10 000 euroa. Hankintapäällikkö vertailee tarjoukset ja valitsee toimittajan. Tilaus tehdään ostotilauksena toimittajalle. Tarvitsija vastaanottaa toimituksen ja kuittaa sen vastaanotetuksi järjestelmässä. Ostoreskontra maksaa laskun vasta kuittauksen jälkeen.`,
    gold: [
      { name: 'Täytä hankintapyyntö', keys: ['täyttää', 'hankintapyynnön'] },
      { name: 'Perustele tarve', keys: ['perustelee'] },
      { name: 'Tarkista kate', keys: ['tarkistaa', 'katetta'] },
      { name: 'Hyväksy pieni hankinta', keys: ['lähiesimies'] },
      { name: 'Hyväksy suuri hankinta', keys: ['talousjohtaja'] },
      { name: 'Pyydä tarjoukset', keys: ['pyytää', 'tarjoukset'] },
      { name: 'Vertaile tarjoukset', keys: ['vertailee'] },
      { name: 'Valitse toimittaja', keys: ['valitsee', 'toimittajan'] },
      { name: 'Tee ostotilaus', keys: ['tilaus tehdään', 'ostotilauksena'] },
      { name: 'Vastaanota toimitus', keys: ['vastaanottaa', 'toimituksen'] },
      { name: 'Kuittaa vastaanotetuksi', keys: ['kuittaa'] },
      { name: 'Maksa lasku', keys: ['maksaa', 'laskun'] },
    ],
    roles: [
      'tarvitsija',
      'budjettivastaava',
      'lähiesimies',
      'talousjohtaja',
      'hankintapäällikkö',
      'ostoreskontra',
    ],
  },
  {
    id: 'poikkeama',
    title: 'Tuotannon poikkeama',
    text: `Poikkeamien käsittely tuotannossa

Operaattori havaitsee poikkeaman koneella ja pysäyttää linjan, jos laatu vaarantuu. Operaattori kirjaa poikkeaman tuotannonohjausjärjestelmään ja ilmoittaa vuoroesimiehelle. Vuoroesimies tarkistaa tilanteen paikan päällä ja päättää jatkotoimista.

Kunnossapito selvittää kone- tai laiteviat ja korjaa ne. Laatuinsinööri eristää epäillyt tuotteet ja tarkastaa ne. Virheelliset tuotteet hylätään tai uudelleentyöstetään. Kun linja on taas kunnossa, vuoroesimies vapauttaa sen tuotantoon. Laatuinsinööri tekee viikoittain juurisyyanalyysin toistuvista poikkeamista ja esittelee tulokset laatukokouksessa.`,
    gold: [
      { name: 'Havaitse poikkeama', keys: ['havaitsee', 'poikkeaman'] },
      { name: 'Pysäytä linja', keys: ['pysäyttää', 'linjan'] },
      { name: 'Kirjaa poikkeama', keys: ['kirjaa', 'poikkeaman'] },
      { name: 'Ilmoita vuoroesimiehelle', keys: ['ilmoittaa', 'vuoroesimiehelle'] },
      { name: 'Tarkista tilanne', keys: ['tarkistaa', 'tilanteen'] },
      { name: 'Päätä jatkotoimista', keys: ['päättää', 'jatkotoimista'] },
      { name: 'Selvitä viat', keys: ['selvittää', 'viat'] },
      { name: 'Korjaa viat', keys: ['korjaa'] },
      { name: 'Eristä tuotteet', keys: ['eristää', 'tuotteet'] },
      { name: 'Tarkasta tuotteet', keys: ['tarkastaa'] },
      { name: 'Hylkää tai työstä uudelleen', keys: ['hylätään'] },
      { name: 'Vapauta linja', keys: ['vapauttaa', 'tuotantoon'] },
      { name: 'Tee juurisyyanalyysi', keys: ['juurisyyanalyysin'] },
      { name: 'Esittele laatukokouksessa', keys: ['esittelee', 'laatukokouksessa'] },
    ],
    roles: ['operaattori', 'vuoroesimies', 'kunnossapito', 'laatuinsinööri'],
  },
]
