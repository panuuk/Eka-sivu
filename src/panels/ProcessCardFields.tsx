import { useRef, useState } from 'react'
import { sanitizeCard } from '../model/serialize'
import type { Process } from '../model/types'
import { useStore } from '../store/store'

const SINGLE = [
  ['purpose', 'Tarkoitus', 'Miksi prosessi on olemassa?'],
  ['owner', 'Omistaja', 'Rooli tai henkilö, joka vastaa prosessista'],
  ['trigger', 'Käynnistäjä', 'Mikä käynnistää prosessin?'],
  ['customer', 'Asiakas', 'Kenelle prosessi tuottaa arvoa?'],
] as const

const LISTS = [
  ['outputs', 'Tuotokset', 'Mitä prosessi tuottaa. Yksi kohta per rivi.'],
  ['metrics', 'Mittarit', 'Miten onnistumista mitataan. Yksi kohta per rivi.'],
  ['risks', 'Riskit', 'Mikä voi mennä pieleen. Yksi kohta per rivi.'],
  ['checklist', 'Tarkistuslista', 'Koko prosessin laatukriteerit. Yksi kohta per rivi.'],
] as const

const toText = (list?: string[]) => (list ?? []).join('\n')
const toList = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

type Form = Record<(typeof SINGLE)[number][0] | (typeof LISTS)[number][0], string>

const formOf = (proc: Process): Form => {
  const c = proc.card ?? {}
  return {
    purpose: c.purpose ?? '',
    owner: c.owner ?? '',
    trigger: c.trigger ?? '',
    customer: c.customer ?? '',
    outputs: toText(c.outputs),
    metrics: toText(c.metrics),
    risks: toText(c.risks),
    checklist: toText(c.checklist),
  }
}

/**
 * Prosessikortin kentät prosessin ominaisuuksissa. Muutokset tallentuvat, kun kohdistus poistuu kortista,
 * jolloin rivinvaihtojen kirjoittaminen ei katkea kesken kirjoituksen. Avaimena on kortin sisältö,
 * joten kumoaminen ja pikasyötteen direktiivit päivittävät kentät.
 */
export function ProcessCardFields({ proc }: { proc: Process }) {
  const stored = JSON.stringify(proc.card ?? {})
  return <CardForm key={`${proc.id}:${stored}`} proc={proc} />
}

function CardForm({ proc }: { proc: Process }) {
  const [form, setForm] = useState<Form>(() => formOf(proc))
  const dirty = useRef(false)

  const commit = () => {
    if (!dirty.current) return
    dirty.current = false
    useStore.getState().dispatch({
      type: 'updateProcess',
      id: proc.id,
      patch: {
        card: sanitizeCard({
          purpose: form.purpose,
          owner: form.owner,
          trigger: form.trigger,
          customer: form.customer,
          outputs: toList(form.outputs),
          metrics: toList(form.metrics),
          risks: toList(form.risks),
          checklist: toList(form.checklist),
        }),
      },
    })
  }
  const set = (k: keyof Form, v: string) => {
    dirty.current = true
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <div
      className="card__fields"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit()
      }}
    >
      {SINGLE.map(([k, label, ph]) => (
        <label key={k} className="field">
          <span className="field__label">{label}</span>
          <input
            value={form[k]}
            placeholder={ph}
            data-testid={`card-${k}`}
            onChange={(e) => set(k, e.target.value)}
          />
        </label>
      ))}
      {LISTS.map(([k, label, hint]) => (
        <label key={k} className="field">
          <span className="field__label">{label}</span>
          <textarea
            rows={3}
            value={form[k]}
            data-testid={`card-${k}`}
            onChange={(e) => set(k, e.target.value)}
          />
          <span className="field__hint">{hint}</span>
        </label>
      ))}
    </div>
  )
}

/** Onko kortissa mitään sisältöä (avataan silloin oletuksena auki). */
export const cardHasContent = (proc: Process) => Object.values(formOf(proc)).some(Boolean)
