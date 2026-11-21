import { useId, useState } from 'react'
import { formatRange, isEmptyRange, parseDuration } from '../model/duration'
import { newId } from '../model/ids'
import type { NodePatch, Operation } from '../model/operations'
import type { DurationRange, PainPoint, PainSeverity, ProcessNode } from '../model/types'
import { ChipPicker } from '../ui/ChipPicker'
import { Icon } from '../ui/Icon'

interface DurationProps {
  label: string
  hint: string
  value: DurationRange | undefined
  onCommit: (v: DurationRange | undefined) => void
}

/** Kestokenttä: arvo tarkistetaan kentästä poistuttaessa, ja virheellinen arvo ei tallennu. */
function DurationField({ label, hint, value, onCommit }: DurationProps) {
  const id = useId()
  const shown = formatRange(value)
  // Muokkausteksti on omana tilanaan, kunnes kenttä menettää fokuksen.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const commit = () => {
    if (draft === null) return
    const text = draft.trim()
    if (text === '') {
      onCommit(undefined)
      setError(false)
    } else {
      const parsed = parseDuration(text)
      if (!parsed) return setError(true)
      onCommit(parsed)
      setError(false)
    }
    setDraft(null)
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft ?? shown}
        placeholder="esim. 2 pv, 30 min, 1-3 pv"
        aria-invalid={error}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            commit()
          } else if (e.key === 'Escape') {
            setDraft(null)
            setError(false)
          }
        }}
      />
      <span id={`${id}-hint`} className={`field__hint ${error ? 'field__hint--error' : ''}`}>
        {error ? 'Ei tunnistettu. Kirjoita esim. “2 pv”, “30 min”, “1-3 pv” tai “1-2-5 pv”.' : hint}
      </span>
    </div>
  )
}

const FREQUENCIES = [
  'päivittäin',
  'viikoittain',
  'kuukausittain',
  'neljännesvuosittain',
  'tapahtumapohjainen',
]

const SEVERITY_LABELS: Record<PainSeverity, string> = {
  1: 'Pieni',
  2: 'Kohtalainen',
  3: 'Vakava',
}

function PainEditor({
  points,
  onChange,
}: {
  points: PainPoint[]
  onChange: (pts: PainPoint[]) => void
}) {
  const update = (id: string, patch: Partial<PainPoint>) =>
    onChange(points.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  return (
    <div className="field">
      <span className="field__label">Kipupisteet ja parannusideat</span>
      <ul className="pain-list">
        {points.map((pp) => (
          <li key={pp.id} className={`pain pain--${pp.severity}`} data-testid="pain-point">
            <input
              type="text"
              aria-label="Kipupiste"
              value={pp.text}
              placeholder="Mikä on ongelma?"
              onChange={(e) => update(pp.id, { text: e.target.value })}
            />
            <select
              aria-label="Vakavuus"
              value={pp.severity}
              onChange={(e) => update(pp.id, { severity: Number(e.target.value) as PainSeverity })}
            >
              {([1, 2, 3] as PainSeverity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              aria-label="Poista kipupiste"
              onClick={() => onChange(points.filter((p) => p.id !== pp.id))}
            >
              <Icon name="trash" size={14} />
            </button>
            <input
              type="text"
              className="pain__idea"
              aria-label="Parannusidea"
              value={pp.idea ?? ''}
              placeholder="Parannusidea (valinnainen)"
              onChange={(e) => update(pp.id, { idea: e.target.value || undefined })}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="linklike"
        onClick={() => onChange([...points, { id: newId('pp'), text: '', severity: 2 }])}
      >
        + Lisää kipupiste
      </button>
    </div>
  )
}

interface WorkProps {
  node: ProcessNode
  patch: (p: NodePatch, extra?: Operation[], key?: string) => void
}

/** Tietotyön kentät: kesto, odotus, toistuvuus, RACI, kipupisteet ja tunnisteet. */
export function WorkSection({ node, patch }: WorkProps) {
  const hasAny =
    !isEmptyRange(node.duration) ||
    !isEmptyRange(node.waiting) ||
    !!node.frequency ||
    !!node.painPoints?.length ||
    !!node.tags?.length ||
    !!(
      node.raci?.accountableIds?.length ||
      node.raci?.consultedIds?.length ||
      node.raci?.informedIds?.length
    )
  const listId = useId()
  const raci = node.raci ?? {}
  const setRaci = (
    key: 'accountableIds' | 'consultedIds' | 'informedIds',
    ids: string[],
    ops: Operation[],
  ) => {
    const next = { ...raci, [key]: ids.length ? ids : undefined }
    const empty = !next.accountableIds && !next.consultedIds && !next.informedIds
    patch({ raci: empty ? undefined : next }, ops)
  }
  const [tagText, setTagText] = useState<string | null>(null)

  return (
    <details className="work" open={hasAny} data-testid="work-section">
      <summary>Tietotyö: kesto, vastuut ja kipupisteet</summary>
      <div className="work__body">
        <DurationField
          label="Työaika"
          hint="Kuinka kauan vaihe vie tekijältä. Päivä = 8 h."
          value={node.duration}
          onCommit={(v) => patch({ duration: v })}
        />
        <DurationField
          label="Odotusaika ennen vaihetta"
          hint="Jonotus tai vastauksen odotus ennen kuin työ voi alkaa."
          value={node.waiting}
          onCommit={(v) => patch({ waiting: v })}
        />
        <div className="field">
          <label className="field__label" htmlFor={`${listId}-freq`}>
            Toistuvuus
          </label>
          <input
            id={`${listId}-freq`}
            type="text"
            list={`${listId}-freqs`}
            value={node.frequency ?? ''}
            placeholder="esim. viikoittain"
            onChange={(e) => patch({ frequency: e.target.value || undefined }, [], 'freq')}
          />
          <datalist id={`${listId}-freqs`}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <ChipPicker
          kind="role"
          label="Hyväksyjä (A, vastuullinen)"
          value={raci.accountableIds ?? []}
          placeholder="Kuka vastaa lopputuloksesta?"
          onChange={(ids, ops) => setRaci('accountableIds', ids, ops)}
        />
        <ChipPicker
          kind="role"
          label="Konsultoitavat (C)"
          value={raci.consultedIds ?? []}
          placeholder="Keneltä kysytään?"
          onChange={(ids, ops) => setRaci('consultedIds', ids, ops)}
        />
        <ChipPicker
          kind="role"
          label="Informoitavat (I)"
          value={raci.informedIds ?? []}
          placeholder="Kenelle kerrotaan?"
          onChange={(ids, ops) => setRaci('informedIds', ids, ops)}
        />
        <PainEditor
          points={node.painPoints ?? []}
          onChange={(pts) => patch({ painPoints: pts.length ? pts : undefined })}
        />
        <div className="field">
          <label className="field__label" htmlFor={`${listId}-tags`}>
            Tunnisteet
          </label>
          <input
            id={`${listId}-tags`}
            type="text"
            value={tagText ?? (node.tags ?? []).join(', ')}
            placeholder="pilkulla erotettuna"
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => {
              if (tagText === null) return
              const tags = [
                ...new Set(
                  tagText
                    .split(',')
                    .map((t) => t.trim().replace(/^#/, ''))
                    .filter(Boolean),
                ),
              ]
              patch({ tags: tags.length ? tags : undefined })
              setTagText(null)
            }}
          />
        </div>
      </div>
    </details>
  )
}
