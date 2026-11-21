import type { EntityKind, Project } from '../model/types'
import { findMentions } from './mentions'
import { ACTION_RE, PASSIVE_RE } from './suggest'
import { capitalize, collapse, splitSentences } from './text'

/**
 * Ehdottaa lähdetekstistä uusia rooleja ja järjestelmiä, joita projektissa ei vielä ole.
 * Näin kymmenien vaiheiden roolit voi luoda yhdellä klikkauksella ennen vaiheiden ehdottamista,
 * jolloin ehdotukset saavat roolinsa automaattisesti.
 */

export interface Candidate {
  kind: Extract<EntityKind, 'role' | 'system'>
  name: string
  count: number
  /** Ehdotetaan valituksi oletuksena (toistuva tai selvästi roolin/järjestelmän näköinen). */
  likely: boolean
}

/** Roolisanojen vartalo ja perusmuoto: "johtajan" -> "johtaja". */
const ROLE_WORDS: [stem: string, base: string][] = [
  ['asiantuntij', 'asiantuntija'],
  ['johtaj', 'johtaja'],
  ['päällik', 'päällikkö'],
  ['esimie', 'esimies'],
  ['koordinaattor', 'koordinaattori'],
  ['sihteer', 'sihteeri'],
  ['suunnittelij', 'suunnittelija'],
  ['vastaav', 'vastaava'],
  ['ohjaaj', 'ohjaaja'],
  ['assistent', 'assistentti'],
  ['kehittäj', 'kehittäjä'],
  ['analyytik', 'analyytikko'],
  ['tarkastaj', 'tarkastaja'],
  ['kirjanpitäj', 'kirjanpitäjä'],
  ['harjoittelij', 'harjoittelija'],
  ['pääkäyttäj', 'pääkäyttäjä'],
]
/** Sanat, jotka kelpaavat roolin nimeksi vain subjektina (liian yleisiä muuten). */
const SUBJECT_SUFFIX = /(?:tuki|osasto|tiimi|yksikkö|palvelu|hallinto|ryhmä|toimisto)$/iu

const SYSTEM_WORDS: [stem: string, base: string][] = [
  ['järjestelm', 'järjestelmä'],
  ['systeem', 'systeemi'],
  ['ohjelm', 'ohjelma'],
  ['portaal', 'portaali'],
  ['sovellu', 'sovellus'],
  ['tietokan', 'tietokanta'],
  ['rekister', 'rekisteri'],
]
const TOOLS = [
  'sähköposti',
  'excel',
  'word',
  'teams',
  'outlook',
  'sharepoint',
  'jira',
  'sap',
  'salesforce',
  'slack',
  'zoom',
  'power bi',
]
/** Verbit, joiden subjekti ei ole toimija ("lasku saapuu"). */
const NON_ACTOR_VERB =
  /^(?:saapu|tallentu|päivity|siirty|etene|tule|alka|päätty|valmistu|vastaanotet|täyty)/iu
const FILLER_HEAD =
  /^(?:(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta|tarvittaessa|yleensä|myös|[\p{L}-]+ jälkeen|[\p{L}-]+ päätyttyä)\s*,?\s+)+/iu
const NOT_ROLE = new Set(['hän', 'se', 'he', 'ne', 'tämä', 'nämä', 'kumpikin', 'molemmat', 'kukin'])

interface Tally {
  kind: Candidate['kind']
  name: string
  count: number
  strong: boolean
}

function add(map: Map<string, Tally>, kind: Candidate['kind'], name: string, strong: boolean) {
  const key = `${kind}:${name.toLocaleLowerCase('fi')}`
  const cur = map.get(key)
  if (cur) {
    cur.count++
    cur.strong ||= strong
  } else map.set(key, { kind, name, count: 1, strong })
}

export function discoverEntities(project: Pick<Project, 'entities'>, text: string): Candidate[] {
  const tallies = new Map<string, Tally>()

  // 1. Roolisanat missä tahansa kohdassa ("talousjohtajan", "HR-asiantuntija")
  for (const [stem, base] of ROLE_WORDS) {
    const re = new RegExp(`(?<![\\p{L}-])([\\p{L}-]*?)${stem}[\\p{L}]*`, 'giu')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const prefix = m[1].replace(/^-+|-+$/g, '')
      const name = capitalize(prefix + (m[1].endsWith('-') ? '-' : '') + base)
      add(tallies, 'role', name.replace(/--/g, '-'), true)
    }
  }

  // 2. Lauseen subjekti ennen toimintaverbiä
  for (const span of splitSentences(text)) {
    const sentence = collapse(span.text).replace(FILLER_HEAD, '')
    const verb = ACTION_RE.exec(sentence)
    if (!verb || verb.index === 0) continue
    const verbWord = /^[\p{L}]+/u.exec(sentence.slice(verb.index))?.[0] ?? ''
    if (PASSIVE_RE.test(verbWord) || NON_ACTOR_VERB.test(verbWord)) continue
    const subject = sentence
      .slice(0, verb.index)
      .replace(/[,:;]+\s*$/, '')
      .trim()
    const words = subject.split(' ')
    if (words.length === 0 || words.length > 3 || /[,;:]/.test(subject)) continue
    if (!/^[\p{Lu}]/u.test(subject)) continue
    if (words.some((w) => NOT_ROLE.has(w.toLocaleLowerCase('fi')))) continue
    // Subjektin on päätyttävä substantiiviin: ei verbimuotoa tai pronominia
    if (words.some((w) => /^(?:jos|kun|että|mikäli|koska)$/i.test(w))) continue
    add(tallies, 'role', capitalize(subject), SUBJECT_SUFFIX.test(subject))
  }

  // 3. Järjestelmät
  for (const [stem, base] of SYSTEM_WORDS) {
    const re = new RegExp(`(?<![\\p{L}-])([\\p{L}-]{2,}?)${stem}[\\p{L}]*`, 'giu')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) add(tallies, 'system', capitalize(m[1] + base), true)
  }
  for (const tool of TOOLS) {
    const re = new RegExp(`(?<![\\p{L}-])${tool}[\\p{L}]*`, 'giu')
    while (re.exec(text)) add(tallies, 'system', capitalize(tool), true)
  }

  const out: Candidate[] = []
  for (const t of tallies.values()) {
    // Jo tunnetut entiteetit (myös taivutusmuodoissa) jätetään pois
    if (findMentions(project, t.name, [t.kind]).length > 0) continue
    // Subjektiehdokas ilman roolisanaa vaatii toistoa; roolisana riittää yhdestäkin maininnasta
    const likely = t.strong || t.count >= 3
    if (!t.strong && t.count < 2) continue
    out.push({ kind: t.kind, name: t.name, count: t.count, likely })
  }
  // Roolin nimi voi sisältyä toiseen ("Esimies" ja "Esimies tiimi"): pidä lyhyin yksilöivä, poista duplikaatit
  return out
    .filter(
      (c, _i, all) =>
        !all.some(
          (o) =>
            o !== c &&
            o.kind === c.kind &&
            o.name.length < c.name.length &&
            c.name.toLocaleLowerCase('fi').endsWith(o.name.toLocaleLowerCase('fi')),
        ),
    )
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fi'))
}
