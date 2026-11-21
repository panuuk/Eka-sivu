import { SYNTAX_HELP } from './example'

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
