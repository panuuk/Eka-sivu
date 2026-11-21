import { parseDuration } from '../model/duration'
import type { DurationRange, PainSeverity, Project } from '../model/types'
import { findMentions } from './mentions'
import { capitalize, collapse, splitSentences, truncate, type Span } from './text'

/**
 * Sääntöpohjainen ehdotusmoottori: ehdottaa lähdetekstistä vaiheita ja päätöksiä. Ehdotukset ovat vain
 * ehdotuksia, ihminen vahvistaa ne. Moottori on `Extractor`-rajapinnan takana, jotta sen voi myöhemmin
 * korvata esimerkiksi paikallisella kielimallilla.
 */

export interface Suggestion {
  id: string
  kind: 'step' | 'decision'
  /** Ehdotuksen kattama alue lähdetekstissä. */
  start: number
  end: number
  quote: string
  label: string
  roleId?: string
  systemIds: string[]
  /** Rooli ja järjestelmät nimenä, kun ne eivät vielä ole projektissa (kielimallin ehdotukset). */
  roleName?: string
  systemNames?: string[]
  /** Ehdotus jatkaa edellistä päätöstä: kyllä- tai ei-haarana. */
  branch?: 'yes' | 'no'
  /** Tekstistä tunnistettu työaika, odotusaika, toistuvuus ja kipupisteet. */
  duration?: DurationRange
  waiting?: DurationRange
  frequency?: string
  pains?: { text: string; severity: PainSeverity }[]
  score: number
  reasons: string[]
}

export interface Extractor {
  suggest(project: Pick<Project, 'entities'>, sourceId: string, text: string): Suggestion[]
}

/** Prosessikuvauksissa tyypillisten toimintaverbien alkuosat (sanan alku, loppu vapaa). */
const ACTION_STEMS = [
  'tarkist',
  'tarkast',
  'lähet',
  'hyväksy',
  'hylk',
  'kirjaa',
  'kirjat',
  'vastaanot',
  'tallen',
  'ilmoit',
  'päättä',
  'päätet',
  'päätt',
  'luodaan',
  'pyyt',
  'pyyd',
  'arvioi',
  'arvioid',
  'käsittel',
  'käsitel',
  'makse',
  'maksa',
  'toimit',
  'laati',
  'laadi',
  'laadit',
  'valits',
  'valitaan',
  'tilaa',
  'tilat',
  'tulost',
  'otta',
  'otet',
  'siirt',
  'siirr',
  'viedä',
  'viedään',
  'vahvist',
  'täyt',
  'täytt',
  'poista',
  'poist',
  'lisää',
  'lisät',
  'päivit',
  'raportoi',
  'raportoid',
  'seuraa',
  'seurata',
  'kontrolloi',
  'kontrolloid',
  'haet',
  'hakee',
  'avataan',
  'sulje',
  'suljet',
  'arkistoi',
  'arkistoid',
  'kuittaa',
  'kuitat',
  'lasket',
  'laskee',
  'vertaa',
  'vertail',
  'valmist',
  'hankk',
  'osta',
  'ostet',
  'syöt',
  'syötet',
  'kerää',
  'kerät',
  'analysoi',
  'analysoid',
  'tunnist',
  'merkits',
  'jaet',
  'jaett',
  'sovit',
  'allekirjoit',
  'saapu',
  'saapuu',
  'vastaa',
  'vastat',
  'palaut',
  'ohjat',
  'ohjaa',
  'asenn',
  'aloit',
  'aloita',
  'lopet',
  'lopeta',
  'järjest',
  'suunnit',
  'toteut',
  'testa',
  'testat',
  'julkais',
  'dokument',
  'kommentoi',
  'kysy',
  'selvit',
  'rekister',
  'perit',
  'varmist',
  'varmenn',
  'siirty',
  'tulee',
  'tulevat',
  'etene',
  'edet',
  'tekee',
  'tekevät',
  'tehdään',
  'koost',
  'perust',
  'pitävät',
  'pidetään',
  'sopii',
  'sovitaan',
  'sopivat',
  'kutsu',
  'ilmoitta',
  'kirjoit',
  'esitte',
  'suorit',
  'havait',
  'pysäyt',
  'vapaut',
  'sulkee',
  'sulke',
  'eskaloi',
  'ehdot',
  'opast',
  'tiedott',
  'kuvaa',
  'luokitt',
  'ajoit',
  'kokoa',
  'kokoo',
  'määrit',
  'nimeä',
  'nimeää',
  'käynnist',
  'hylät',
  'eristä',
  'eristet',
  'tarjo',
  'korja',
  'kuittaa',
  'vahvist',
]
/** Lyhyet verbit tunnistetaan vain kokonaisina sanoina (esim. "luo" ei saa osua sanaan "luottoraja"). */
const SHORT_VERBS = [
  'luo',
  'vie',
  'hae',
  'ota',
  'avaa',
  'luodaan',
  'otetaan',
  'haetaan',
  'viedään',
  'avataan',
]
export const ACTION_RE = new RegExp(
  `(?<![\\p{L}])(?:(?:${ACTION_STEMS.join('|')})[\\p{L}]*|(?:${SHORT_VERBS.join('|')})(?![\\p{L}]))`,
  'iu',
)
/** Passiivin preesens ja imperfekti: "lähetetään", "tarkistettiin". */
export const PASSIVE_RE = /(?<![\p{L}])[\p{L}]{4,}(?:taan|tään|ttiin|ttäisiin)(?![\p{L}])/iu
const SEQUENCE_RE =
  /(?<![\p{L}])(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|jälkeenpäin|lopuksi|viimeiseksi|lopulta|samalla)(?![\p{L}])/iu
const CONDITION_RE = /^\s*(?:jos taas|jos|mikäli|kun)\s+([^,;]{3,}?)\s*,\s*(.+)$/isu
const ELSE_RE =
  /^\s*(?:muussa tapauksessa|muuten|jos ei|ellei|ellei niin|mikäli ei)\b[\s,:]*(.*)$/isu
/** Lauseen alun täteosa, joka ei kuulu vaiheen nimeen: "Lopuksi", "Haastattelun jälkeen", "Tarvittaessa". */
const LEAD_FILLER =
  /^(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta|tarvittaessa|yleensä|myös|[\p{L}-]+ jälkeen|[\p{L}-]+ päätyttyä)$/iu
const LEADING_SEQUENCE_RE =
  /^(?:(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta|tarvittaessa|yleensä)|[\p{L}-]+ jälkeen|[\p{L}-]+ päätyttyä)\s*,?\s+/iu

const isLeadFiller = (lead: string) => LEAD_FILLER.test(lead)

function cleanLabel(s: string): string {
  const t = collapse(s)
    .replace(LEADING_SEQUENCE_RE, '')
    .replace(/[.!?…:;,\s]+$/, '')
  return truncate(capitalize(t), 90)
}

function wordCount(s: string): number {
  return collapse(s).split(' ').filter(Boolean).length
}

interface Draft {
  span: Span
  start: number
  end: number
  text: string
  kind: 'step' | 'decision'
  label: string
  branch?: 'yes' | 'no'
  /** Osalause perii roolin aiemmalta luonnokselta ("A tekee X ja tekee Y"). */
  inheritFrom?: number
  pains?: { text: string; severity: PainSeverity }[]
  score: number
  reasons: string[]
}

const ACTION_G = new RegExp(ACTION_RE.source, 'giu')
/** Substantiivit ("hyväksyntä", "tarkastus") eivät ole toimintaverbejä, vaikka alkaisivat verbin vartalolla. */
const NOUN_ENDING = /(?:nti|ntä|ntö|minen|mis[\p{L}]*|us|ys|uus|yys|inta|ointi|ukset|ykset|ely)$/iu

function hasActionVerb(text: string): boolean {
  ACTION_G.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ACTION_G.exec(text))) {
    const word = /^[\p{L}]+/u.exec(text.slice(m.index))?.[0] ?? m[0]
    if (!NOUN_ENDING.test(word)) return true
  }
  return false
}

function scoreSentence(
  text: string,
  listItem: boolean,
  allowShort = false,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  if (listItem) {
    score += 3
    reasons.push('luetteloitu kohta')
  }
  if (PASSIVE_RE.test(text)) {
    score += 2
    reasons.push('toimintaa kuvaava passiivi')
  } else if (hasActionVerb(text)) {
    score += 2
    reasons.push('toimintaverbi')
  }
  if (SEQUENCE_RE.test(text)) {
    score += 1
    reasons.push('järjestyssana')
  }
  if (/(?<![\p{L}])alkaa,?\s+(?:kun|silloin)(?![\p{L}])/iu.test(text)) {
    score -= 2
    reasons.push('prosessin alkuehto')
  }
  const words = wordCount(text)
  if (words > 32) score -= 2
  if (words < 3 && !allowShort) score -= 2
  return { score, reasons }
}

/** Lauseen alussa (subjektina) mainittu rooli, jos sellainen on. */
export function leadingRoleMention(
  project: Pick<Project, 'entities'>,
  text: string,
): string | undefined {
  const m = findMentions(project, text, ['role']).find((x) => {
    const lead = collapse(text.slice(0, x.start)).replace(/[,:\s]+$/, '')
    return lead === '' || isLeadFiller(lead)
  })
  return m?.entityId
}

// --- Aikailmaisut, toistuvuus ja kipupisteet ---

const NUM_WORD =
  '(?:yksi|yhden|kaksi|kahden|kolme|kolmen|neljä|neljän|viisi|viiden|kuusi|kuuden|seitsemän|kahdeksan|yhdeksän|kymmenen|puoli|puolen)'
const DURATION_RE = new RegExp(
  `(?<![\\p{L}\\d])(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|${NUM_WORD})\\s*(?:työ)?(min[\\p{L}]*|h|tun[\\p{L}]*|pv|päiv[\\p{L}]*|vk|viik[\\p{L}]*|kk|kuuka[\\p{L}]*|kuukau[\\p{L}]*)(?![\\p{L}])`,
  'iu',
)
const BARE_DURATION_RE =
  /(?<![\p{L}])(?:viikon|kuukauden|päivän|tunnin)\s+(?:kuluessa|kuluttua|sisällä|aikana)/iu
/** Jonotus ja vastauksen odotus ovat odotusaikaa, muu kesto työaikaa. */
const WAIT_RE =
  /(?<![\p{L}])(?:odot[\p{L}]*|kuluessa|kuluttua|jonossa|viiveellä|vastauksen jälkeen|toimitusaika)/iu
const FREQUENCY_RE =
  /(?<![\p{L}])(päivittäin|viikoittain|kuukausittain|neljännesvuosittain|vuosittain|joka päivä|joka viikko|joka kuukausi|kerran (?:päivässä|viikossa|kuussa|vuodessa))(?![\p{L}])/iu
const PAIN_RE =
  /(?<![\p{L}])(?:viivästy[\p{L}]*|myöhässä|ongelm[\p{L}]*|hankala[\p{L}]*|hidas[\p{L}]*|virhealtis[\p{L}]*|pullonkaul[\p{L}]*|manuaalinen|manuaalisesti|käsin tehtävä[\p{L}]*|epäselv[\p{L}]*|työläs[\p{L}]*|toistuvasti|jumittu[\p{L}]*|kiireell[\p{L}]*|puutteellis[\p{L}]*)(?![\p{L}])/iu
const SEVERE_RE =
  /(?<![\p{L}])(?:usein|aina|jatkuvasti|toistuvasti|säännöllisesti|kriittis[\p{L}]*)(?![\p{L}])/iu

export function extractTiming(text: string): {
  duration?: DurationRange
  waiting?: DurationRange
  frequency?: string
} {
  const out: ReturnType<typeof extractTiming> = {}
  const m = DURATION_RE.exec(text)
  if (m) {
    const u = m[2].toLocaleLowerCase('fi')
    const unit = u.startsWith('min')
      ? 'min'
      : u.startsWith('tun') || u === 'h'
        ? 'h'
        : u.startsWith('päiv') || u === 'pv'
          ? 'pv'
          : u.startsWith('viik') || u === 'vk'
            ? 'vk'
            : 'kk'
    const range = parseDuration(`${m[1].replace(/\s+/g, '')} ${unit}`)
    if (range) {
      // Odotussana lähellä (ennen tai jälkeen) tekee kestosta odotusaikaa
      const near = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 24)
      if (WAIT_RE.test(near)) out.waiting = range
      else out.duration = range
    }
  } else if (BARE_DURATION_RE.test(text)) {
    const b = BARE_DURATION_RE.exec(text)![0].split(/\s+/)[0]
    const range = parseDuration(b)
    if (range) out.waiting = range
  }
  const f = FREQUENCY_RE.exec(text)
  if (f) out.frequency = f[1].toLocaleLowerCase('fi')
  return out
}

/** Kipupiste lauseesta, jos siinä on ongelmaan viittaava sana. */
export function extractPain(text: string): { text: string; severity: PainSeverity } | undefined {
  if (!PAIN_RE.test(text)) return undefined
  const severity: PainSeverity = SEVERE_RE.test(text) ? 3 : 2
  return { text: truncate(capitalize(collapse(text).replace(/[.!?…:;,\s]+$/, '')), 90), severity }
}

/** Verbin alku sanan alussa: samat kuin ACTION_RE, mutta ankkuroitu positioon. */
const VERB_AHEAD = `(?=(?:(?:${ACTION_STEMS.join('|')})[\\p{L}]*|(?:${SHORT_VERBS.join('|')})(?![\\p{L}])))`
const CLAUSE_SPLIT_RE = new RegExp(
  `(?:,\\s*(?:ja\\s+|sekä\\s+)?|\\s+(?:ja|sekä)\\s+)${VERB_AHEAD}|,\\s*(?:jolloin|minkä jälkeen|jonka jälkeen)\\s+`,
  'giu',
)
/** Substantiivien päätteitä, joiden perusteella "ja hyväksyntä" ei ole uusi toimenpide. */
/** Äänteitä, joihin finiittiverbit (ja imperatiivit) päättyvät. Poistaa "ja arviointien perusteella" -tyyppiset osumat. */
const FINITE =
  /(?:aa|ää|ee|ii|oo|uu|yy|öö|uo|ie|ae|oi|äi|ui|ai|ei|ta|tä|vat|vät|[td]aan|[td]ään|ttiin|si)$/iu
const NOUNISH = /(?:nti|ntä|ntö|minen|mis[\p{L}]*|us|ys|uus|yys|inta|ointi|ukset|ykset)$/iu

/** Pilkkoo yhdistetyn lauseen ("A ja B") osalauseiksi, kun jälkimmäinen alkaa toimintaverbillä. */
function splitClauses(sentence: string): { start: number; end: number }[] {
  const cuts: { from: number; to: number }[] = []
  CLAUSE_SPLIT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CLAUSE_SPLIT_RE.exec(sentence))) {
    const rest = sentence.slice(m.index + m[0].length)
    const first = /^[\p{L}-]+/u.exec(rest)?.[0] ?? ''
    // Pilkku ilman "ja"-sanaa on usein luettelo: vaadi silloin verbimäinen sana.
    if (NOUNISH.test(first) || !FINITE.test(first)) continue
    cuts.push({ from: m.index, to: m.index + m[0].length })
    if (m[0].length === 0) CLAUSE_SPLIT_RE.lastIndex++
  }
  if (!cuts.length) return [{ start: 0, end: sentence.length }]
  const parts: { start: number; end: number }[] = []
  let at = 0
  for (const c of cuts) {
    parts.push({ start: at, end: c.from })
    at = c.to
  }
  parts.push({ start: at, end: sentence.length })
  return parts.filter((p) => collapse(sentence.slice(p.start, p.end)).split(' ').length >= 2)
}

export const ruleExtractor: Extractor = {
  suggest(project, sourceId, text) {
    const drafts: Draft[] = []
    const sentences = splitSentences(text)
    let lastWasDecision = false

    for (const span of sentences) {
      const sentence = span.text
      const cond = CONDITION_RE.exec(sentence)
      const other = ELSE_RE.exec(sentence)

      if (cond && /^\s*kun\b/iu.test(sentence)) {
        // "Kun X, tee Y": ajankohta, ei päätös. Vaihe on seuraus; ehto jää nimen ulkopuolelle.
        const conseq = cond[2]
        const conseqStart = span.start + sentence.lastIndexOf(conseq)
        const sc = scoreSentence(conseq, false)
        if (sc.score >= 1) {
          drafts.push({
            span,
            start: conseqStart,
            end: span.end,
            text: text.slice(conseqStart, span.end),
            kind: 'step',
            label: cleanLabel(conseq),
            score: sc.score,
            reasons: ['ajankohtalause (kun)', ...sc.reasons],
          })
        }
        lastWasDecision = false
        continue
      }

      if (cond) {
        const condText = cond[1]
        const condStart = span.start + sentence.indexOf(cond[1])
        drafts.push({
          span,
          start: span.start,
          end: condStart + condText.length,
          text: text.slice(span.start, condStart + condText.length),
          kind: 'decision',
          label: `${cleanLabel(condText)}?`,
          score: 4,
          reasons: ['ehtolause (jos/mikäli)'],
        })
        const conseq = cond[2]
        const conseqStart = span.start + sentence.lastIndexOf(conseq)
        const sc = scoreSentence(conseq, false)
        drafts.push({
          span,
          start: conseqStart,
          end: span.end,
          text: text.slice(conseqStart, span.end),
          kind: 'step',
          label: cleanLabel(conseq),
          branch: 'yes',
          score: Math.max(sc.score, 2),
          reasons: ['ehdon seuraus', ...sc.reasons],
        })
        lastWasDecision = true
        continue
      }

      if (other && lastWasDecision) {
        const rest = other[1].trim()
        if (rest) {
          const restStart = span.start + sentence.lastIndexOf(rest)
          const sc = scoreSentence(rest, false)
          drafts.push({
            span,
            start: restStart,
            end: span.end,
            text: text.slice(restStart, span.end),
            kind: 'step',
            label: cleanLabel(rest),
            branch: 'no',
            score: Math.max(sc.score, 2),
            reasons: ['muussa tapauksessa', ...sc.reasons],
          })
          lastWasDecision = false
          continue
        }
      }

      if (/\?$/.test(sentence) && wordCount(sentence) >= 3) {
        drafts.push({
          span,
          start: span.start,
          end: span.end,
          text: sentence,
          kind: 'decision',
          label: cleanLabel(sentence) + '?',
          score: 3,
          reasons: ['kysymys'],
        })
        lastWasDecision = true
        continue
      }

      const { score, reasons } = scoreSentence(sentence, span.listItem)
      if (score >= 1) {
        const parts = span.listItem ? [{ start: 0, end: sentence.length }] : splitClauses(sentence)
        let firstIndex = -1
        for (const [k, part] of parts.entries()) {
          const partText = sentence.slice(part.start, part.end)
          // Jokainen osalause arvioidaan itse, mutta ensimmäinen säilyttää koko lauseen pisteet.
          const sc = k === 0 ? { score, reasons } : scoreSentence(partText, false, true)
          if (k > 0 && sc.score < 1) continue
          if (k === 0) firstIndex = drafts.length
          drafts.push({
            span,
            start: span.start + part.start,
            end: span.start + part.end,
            text: partText,
            kind: 'step',
            label: cleanLabel(partText),
            score: sc.score,
            reasons: k === 0 ? reasons : [...sc.reasons, 'osalause'],
            inheritFrom: k > 0 ? firstIndex : undefined,
            pains: (() => {
              const pain = extractPain(partText)
              return pain ? [pain] : undefined
            })(),
          })
        }
      } else {
        // Ongelmaa kuvaava lause, joka ei ole vaihe, liitetään edeltävään vaiheeseen kipupisteeksi.
        const pain = extractPain(sentence)
        const prev = [...drafts].reverse().find((d) => d.kind === 'step')
        if (pain && prev) prev.pains = [...(prev.pains ?? []), pain]
      }
      lastWasDecision = false
    }

    // Maininnat rikastavat ehdotukset rooleilla ja järjestelmillä.
    const mentions = findMentions(project, text, ['role', 'system'])
    // Maininnat ovat järjestyksessä: alue haetaan binäärihaulla, jotta pitkät tekstit pysyvät nopeina.
    const mentionsIn = (start: number, end: number) => {
      let lo = 0
      let hi = mentions.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (mentions[mid].start < start) lo = mid + 1
        else hi = mid
      }
      const found: typeof mentions = []
      for (let k = lo; k < mentions.length && mentions[k].start < end; k++) {
        if (mentions[k].end <= end) found.push(mentions[k])
      }
      return found
    }
    // Rooli on toimija: se tunnistetaan vain lauseen alusta (subjekti), jottei vastaanottaja
    // ("lähetetään esimiehelle") tulkita vastuutahoksi.
    const leadingRole = (d: Draft) =>
      d.kind === 'step'
        ? mentionsIn(d.start, d.end).find((m) => {
            if (m.kind !== 'role') return false
            const lead = collapse(text.slice(d.start, m.start)).replace(/[,:\s]+$/, '')
            return lead === '' || isLeadFiller(lead)
          })
        : undefined
    const roles = drafts.map(leadingRole)
    return drafts.map((d, i) => {
      const inside = mentionsIn(d.start, d.end)
      // Järjestelmät voivat olla missä tahansa lauseessa; ehdon seurauksella katsotaan koko lausetta.
      const scope = d.kind === 'step' && d.branch ? mentionsIn(d.span.start, d.span.end) : inside
      const ownRole = roles[i]
      const role = ownRole ?? (d.inheritFrom !== undefined ? roles[d.inheritFrom] : undefined)
      // Alussa oleva rooli kuuluu rooliksi, ei vaiheen nimeen: "HR tarkistaa pyynnön" -> "Tarkistaa pyynnön".
      let label = d.label
      if (ownRole && d.kind === 'step') {
        const rest = collapse(text.slice(ownRole.end, d.end))
        if (wordCount(rest) >= 2) label = cleanLabel(rest)
      }
      const systems =
        d.kind === 'step'
          ? [...new Set(scope.filter((m) => m.kind === 'system').map((m) => m.entityId))]
          : []
      const reasons = [...d.reasons]
      let score = d.score
      if (role) {
        score += 1
        reasons.push(`rooli: ${project.entities[role.entityId].name}`)
      }
      if (systems.length) {
        score += 1
        reasons.push(`järjestelmä: ${systems.map((s) => project.entities[s].name).join(', ')}`)
      }
      return {
        id: `${sourceId}:${d.start}-${d.end}:${i}`,
        kind: d.kind,
        start: d.start,
        end: d.end,
        quote: d.text,
        label,
        roleId: role?.entityId,
        systemIds: systems,
        branch: d.branch,
        ...(d.kind === 'step' ? extractTiming(d.text) : {}),
        ...(d.pains?.length ? { pains: d.pains } : {}),
        score,
        reasons,
      } satisfies Suggestion
    })
  },
}
