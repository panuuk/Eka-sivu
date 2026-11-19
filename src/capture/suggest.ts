import type { Project } from '../model/types'
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
  /** Ehdotus jatkaa edellistä päätöstä: kyllä- tai ei-haarana. */
  branch?: 'yes' | 'no'
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
const ACTION_RE = new RegExp(
  `(?<![\\p{L}])(?:(?:${ACTION_STEMS.join('|')})[\\p{L}]*|(?:${SHORT_VERBS.join('|')})(?![\\p{L}]))`,
  'iu',
)
/** Passiivin preesens ja imperfekti: "lähetetään", "tarkistettiin". */
const PASSIVE_RE = /(?<![\p{L}])[\p{L}]{4,}(?:taan|tään|ttiin|ttäisiin)(?![\p{L}])/iu
const SEQUENCE_RE =
  /(?<![\p{L}])(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|jälkeenpäin|lopuksi|viimeiseksi|lopulta|samalla)(?![\p{L}])/iu
const CONDITION_RE = /^\s*(?:jos taas|jos|mikäli|kun)\s+([^,;]{3,}?)\s*,\s*(.+)$/isu
const ELSE_RE =
  /^\s*(?:muussa tapauksessa|muuten|jos ei|ellei|ellei niin|mikäli ei)\b[\s,:]*(.*)$/isu
const LEADING_SEQUENCE_RE =
  /^(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta)\s*,?\s+/iu

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
  score: number
  reasons: string[]
}

function scoreSentence(text: string, listItem: boolean): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  if (listItem) {
    score += 3
    reasons.push('luetteloitu kohta')
  }
  if (PASSIVE_RE.test(text)) {
    score += 2
    reasons.push('toimintaa kuvaava passiivi')
  } else if (ACTION_RE.test(text)) {
    score += 2
    reasons.push('toimintaverbi')
  }
  if (SEQUENCE_RE.test(text)) {
    score += 1
    reasons.push('järjestyssana')
  }
  const words = wordCount(text)
  if (words > 32) score -= 2
  if (words < 3) score -= 2
  return { score, reasons }
}

/** Lauseen alussa (subjektina) mainittu rooli, jos sellainen on. */
export function leadingRoleMention(
  project: Pick<Project, 'entities'>,
  text: string,
): string | undefined {
  const m = findMentions(project, text, ['role']).find((x) => {
    const lead = collapse(text.slice(0, x.start)).replace(/[,:\s]+$/, '')
    return (
      lead === '' ||
      /^(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta)$/i.test(
        lead,
      )
    )
  })
  return m?.entityId
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
        drafts.push({
          span,
          start: span.start,
          end: span.end,
          text: sentence,
          kind: 'step',
          label: cleanLabel(sentence),
          score,
          reasons,
        })
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
    return drafts.map((d, i) => {
      const inside = mentionsIn(d.start, d.end)
      // Järjestelmät voivat olla missä tahansa lauseessa; ehdon seurauksella katsotaan koko lausetta.
      const scope = d.kind === 'step' && d.branch ? mentionsIn(d.span.start, d.span.end) : inside
      // Rooli on toimija: se tunnistetaan vain lauseen alusta (subjekti), jottei vastaanottaja
      // ("lähetetään esimiehelle") tulkita vastuutahoksi.
      const role =
        d.kind === 'step'
          ? inside.find((m) => {
              if (m.kind !== 'role') return false
              const lead = collapse(text.slice(d.start, m.start)).replace(/[,:\s]+$/, '')
              return (
                lead === '' ||
                /^(?:ensin|aluksi|sitten|seuraavaksi|tämän jälkeen|sen jälkeen|lopuksi|viimeiseksi|lopulta)$/i.test(
                  lead,
                )
              )
            })
          : undefined
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
        label: d.label,
        roleId: role?.entityId,
        systemIds: systems,
        branch: d.branch,
        score,
        reasons,
      } satisfies Suggestion
    })
  },
}
