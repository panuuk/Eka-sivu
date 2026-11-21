import type { Gap } from '../analysis/gaps'
import type { Project } from '../model/types'
import { SYNTAX_HELP } from './example'
import { processToText } from './serialize'

/**
 * Valmis esimerkki, jonka tekoäly saa mallikseen. Sen on oltava jäsennettävissä ilman virheitä
 * (testattu), koska tekoäly jäljittelee sitä.
 */
export const AI_EXAMPLE = `# Matkalaskun käsittely
alku: Matkalasku jätetään
- Täytä matkalasku @Työntekijä [Matkahallinta] < Kuitit > Matkalasku =30 min
- Tarkista ja hyväksy @Esimies [Matkahallinta] =10 min ^2 pv
  Esimies tarkistaa kuitit ja matkan tarkoituksen.
  !3 Kuitit puuttuvat usein => Pakollinen kuittiliite lomakkeella
? Ylittääkö summa 1000 euroa
  kyllä: Hyväksy erikseen @Talousjohtaja ^1 pv
  ei: jatka
+ Maksu @Talous
  - Tarkista verovapaat korvaukset @Palkka-asiantuntija [Palkanlaskenta] =15 min
  - Maksa korvaus palkanmaksun yhteydessä [Palkanlaskenta] %kuukausittain
? Onko tiedoissa virhe ~arvaus
  kyllä: -> Täytä matkalasku
  ei: jatka
loppu: Korvaus maksettu`

/**
 * Ohje, jonka voi antaa tekoälylle (ChatGPT, Claude, Copilot jne.) yhdessä omien muistiinpanojen
 * kanssa. Tekoäly palauttaa tekstin, jonka voi liittää pikasyötteeseen. Syntaksitaulukko tulee
 * `SYNTAX_HELP`istä, joten ohje pysyy ajan tasalla, kun syntaksi muuttuu.
 */
export function buildAiPrompt(): string {
  const syntax = SYNTAX_HELP.map((h) => `  ${h.syntax}   →   ${h.meaning}`).join('\n')
  return `Muotoile alla olevat muistiinpanot prosessikuvaukseksi käyttämällä tarkasti tätä tekstisyntaksia. Vastaa pelkällä koodilohkolla (kolme heittomerkkiä alussa ja lopussa) ilman selityksiä, otsikoita tai johdantoa.

SYNTAKSI
${syntax}

SÄÄNNÖT
- Yksi rivi on yksi vaihe. Nimeä vaihe lyhyesti toimintana ("Tarkista lasku", "Hyväksy matkalasku"), ei kokonaisena lauseena.
- Kirjoita vaiheet siinä järjestyksessä kuin ne tapahtuvat. Rivien järjestys on prosessin kulku.
- Käytä samaa nimeä samalle roolille, järjestelmälle ja vaiheelle joka kerta. Älä keksi uusia nimiä synonyymeille.
- Päätös on kysymys ("? Ylittääkö summa 1000 euroa"), ja sen haarat kirjoitetaan sisennettynä: "kyllä: ..." ja "ei: ...". Haara voi jatkaa kulkua ("jatka"), päättyä ("loppu") tai palata aiempaan vaiheeseen ("-> Vaiheen nimi").
- Alaprosessi alkaa merkillä "+", ja sen vaiheet sisennetään sen alle kahdella välilyönnillä.
- Sisennä kaksi välilyöntiä per taso. Älä käytä tabulaattoreita.
- Lisää rooli (@), järjestelmä ([ ]), syöte (<), tuotos (>), työ- ja odotusaika (= ja ^), toistuvuus (%), tunnisteet (#), kipupisteet (!) ja RACI-merkinnät vain, jos muistiinpanoissa sanotaan ne selvästi.
- Älä keksi tietoa, jota muistiinpanoissa ei ole. Jos tieto on epävarma tai oma tulkintasi, lisää vaiheen loppuun ~arvaus.
- Jos jokin jää epäselväksi, älä arvaa hiljaa. Kirjoita kysymys kommenttiriville ("// Avoin: kuka hyväksyy yli 1000 euron laskut?") sen vaiheen kohdalle, jota se koskee.
- Tavallinen sisennetty teksti vaiheen alla tallentuu vaiheen kuvaukseksi. Käytä sitä perusteluille ja lisätiedoille.
- Aloita halutessasi rivillä "# Prosessin nimi". Käytä "alku" ja "loppu" -rivejä, jos prosessin alku- ja päätepiste ovat tiedossa.

ESIMERKKI (näin tuloksen pitää näyttää)
\`\`\`
${AI_EXAMPLE}
\`\`\`

MUISTIINPANOT (muotoile nämä)
[Liitä muistiinpanot tähän]`
}

const syntaxBlock = () => SYNTAX_HELP.map((h) => `  ${h.syntax}   →   ${h.meaning}`).join('\n')

/** Käyttäjälle näytettävä ohjepohja: otsikko, kuvaus ja valmis teksti. */
export interface AiTemplate {
  id: 'format' | 'review' | 'interview' | 'present'
  title: string
  description: string
  /** Mitä tekoälyltä pyydetään ja mitä sen vastauksella tehdään. */
  usage: string
  text: string
}

/**
 * Nykyinen prosessi tekstinä. Teksti sisältää kaiken, mitä käyttäjä kopioi tekoälylle (nimet, roolit,
 * järjestelmät, kuvaukset), joten se näytetään käyttäjälle ennen kopiointia.
 */
export function currentProcessText(project: Project, processId: string): string {
  return processToText(project, processId, { title: true })
}

/** Arvioi nykyinen prosessi: tekoäly palauttaa koko prosessin parannettuna, ja muutokset näkyvät erona ennen lisäämistä. */
export function buildReviewPrompt(project: Project, processId: string, open: Gap[]): string {
  const questions = open
    .filter((g) => g.processId === processId)
    .slice(0, 25)
    .map((g) => `- ${g.text}`)
    .join('\n')
  return `Olet prosessianalyytikko. Alla on prosessin nykyinen kuvaus pikasyötteen tekstimuodossa ja siitä automaattisesti löydetyt avoimet kysymykset. Arvioi prosessi ja palauta koko prosessi parannettuna samalla tekstisyntaksilla.

Vastaa pelkällä koodilohkolla (kolme heittomerkkiä alussa ja lopussa) ilman johdantoa tai selityksiä.

SYNTAKSI
${syntaxBlock()}

SÄÄNNÖT
- Säilytä kaikki nykyiset vaiheet, rooli- ja järjestelmämerkinnät sekä kuvaukset, ellei niissä ole selvää virhettä.
- Jos nimeät vaiheen uudelleen, käytä muotoa "Uusi nimi (aiemmin: Vanha nimi)". Älä muuten vaihda vaiheiden nimiä.
- Poista vaihe vain, jos se on selvästi päällekkäinen toisen kanssa. Jätä poistettu vaihe pois tekstistä.
- Lisää puuttuvia päätöksiä, haaroja, paluita ja poikkeuspolkuja vain, jos prosessin logiikka niitä vaatii. Merkitse omat oletuksesi ~arvaus.
- Älä keksi roolien, järjestelmien tai aikojen nimiä. Kirjoita avoimet kysymykset kommenttiriveille ("// Avoin: kuka hyväksyy yli 1000 euron laskut?") sen vaiheen kohdalle, jota ne koskevat.
- Jos huomaat pullonkauloja, turhia luovutuksia tai odotusta, kirjaa ne kipupisteenä ("!2 Ongelma => Parannusidea") kyseiselle vaiheelle.

AVOIMET KYSYMYKSET (automaattisesti löydetyt)
${questions || '- (ei avoimia kysymyksiä)'}

NYKYINEN PROSESSI
\`\`\`
${currentProcessText(project, processId)}
\`\`\``
}

/** Haastattelukysymykset avoimista kysymyksistä. Vastaus on tekstiä, jota ei liitetä takaisin. */
export function buildInterviewPrompt(project: Project, processId: string, open: Gap[]): string {
  const proc = project.processes[processId]
  const gaps = open
    .filter((g) => g.processId === processId)
    .slice(0, 30)
    .map((g) => {
      const node = g.targetId ? project.nodes[g.targetId] : undefined
      return `- ${node ? `[${node.label}] ` : ''}${g.text}`
    })
    .join('\n')
  return `Autan valmistautumaan prosessin asiantuntijahaastatteluun. Prosessi: "${proc?.name ?? 'Prosessi'}".

Alla on kysymyksiä, joihin prosessin kuvauksesta puuttuu vastaus. Laadi niistä haastattelurunko suomeksi:
- Ryhmittele kysymykset aiheittain (esim. roolit ja vastuut, poikkeukset, järjestelmät, ajat ja odotus).
- Muotoile jokainen kysymys avoimeksi kysymykseksi, johon ei vastata kyllä tai ei, ja lisää tarvittaessa jatkokysymys.
- Aloita helpoimmista ja etene vaikeimpiin. Lisää loppuun kolme kysymystä siitä, mikä prosessissa tuntuu haastattelijasta hankalimmalta.
- Älä oleta vastauksia äläkä lisää tietoa, jota alla ei ole.

AVOIMET KYSYMYKSET
${gaps || '- (ei avoimia kysymyksiä)'}

PROSESSIN KUVAUS
\`\`\`
${currentProcessText(project, processId)}
\`\`\``
}

/** Esityksen kuvausteksti prosessista. */
export function buildPresentationPrompt(project: Project, processId: string): string {
  return `Kirjoita alla olevasta prosessista lyhyt esittelyteksti suomeksi, jota voi käyttää esityksen puheena tai dian muistiinpanoina.

Rakenne:
1. Yksi virke: mikä prosessi on ja mihin se päättyy.
2. Kulku 5–8 virkkeellä: tärkeimmät vaiheet järjestyksessä, ketkä niitä tekevät ja mitkä ovat päätöskohdat.
3. Kolme havaintoa: missä on odotusta, luovutuksia, kipupisteitä tai epävarmuutta (vain jos kuvauksessa on niistä tietoa).
4. Yksi kysymys, jonka yleisön kannattaa pohtia.

Käytä vain kuvauksessa olevaa tietoa. Merkintä "~arvaus" tarkoittaa, ettei tietoa ole vahvistettu: mainitse se esityksessä varovaisesti.

PROSESSIN KUVAUS
\`\`\`
${currentProcessText(project, processId)}
\`\`\``
}

export function buildTemplates(project: Project, processId: string, open: Gap[]): AiTemplate[] {
  return [
    {
      id: 'format',
      title: 'Muotoile muistiinpanot',
      description: 'Vapaat muistiinpanot tai dokumentti pikasyötteen muotoon.',
      usage:
        'Liitä ohje tekoälyyn ja korvaa lopun kohta [Liitä muistiinpanot tähän] omilla muistiinpanoillasi. Liitä vastaus tähän ja valitse tarvittaessa Siivoa vastaus.',
      text: buildAiPrompt(),
    },
    {
      id: 'review',
      title: 'Arvioi nykyinen prosessi',
      description: 'Tekoäly ehdottaa parannuksia, puuttuvia haaroja ja kysymyksiä.',
      usage:
        'Liitä ohje tekoälyyn ja liitä vastaus tähän. Muutokset näytetään eroina ennen lisäämistä. Ota Poista-valinta käyttöön, jos haluat hyväksyä myös tekoälyn poistamat vaiheet.',
      text: buildReviewPrompt(project, processId, open),
    },
    {
      id: 'interview',
      title: 'Haastattelukysymykset',
      description: 'Avoimista kysymyksistä haastattelurunko asiantuntijalle.',
      usage:
        'Vastausta ei liitetä takaisin. Käytä sitä haastattelun pohjana ja kirjaa vastaukset muistiinpanoiksi.',
      text: buildInterviewPrompt(project, processId, open),
    },
    {
      id: 'present',
      title: 'Esittelyteksti',
      description: 'Prosessin kulku puheeksi tai dian muistiinpanoiksi.',
      usage: 'Vastausta ei liitetä takaisin. Kopioi se esityksesi muistiinpanoihin.',
      text: buildPresentationPrompt(project, processId),
    },
  ]
}
