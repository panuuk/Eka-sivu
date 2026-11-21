import { useEffect, useRef, useState } from 'react'
import { sanitizeCard } from '../model/serialize'
import type { ProcessCard } from '../model/types'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

const LISTS: { key: 'outputs' | 'metrics' | 'risks' | 'checklist'; label: string; hint: string }[] =
  [
    { key: 'outputs', label: 'Tuotokset', hint: 'Mitä prosessi tuottaa. Yksi kohta per rivi.' },
    {
      key: 'metrics',
      label: 'Mittarit',
      hint: 'Miten onnistumista mitataan. Yksi kohta per rivi.',
    },
    { key: 'risks', label: 'Riskit', hint: 'Mikä voi mennä pieleen. Yksi kohta per rivi.' },
    {
      key: 'checklist',
      label: 'Tarkistuslista',
      hint: 'Koko prosessin laatukriteerit ennen valmistumista. Yksi kohta per rivi.',
    },
  ]

/** Prosessikortti: prosessin tarkoitus, omistaja, käynnistäjä, asiakas, tuotokset, mittarit, riskit ja tarkistuslista. */
export function ProcessCardDialog() {
  const open = useUi((s) => s.cardOpen)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide"
      onClose={() => useUi.getState().setCardOpen(false)}
      aria-labelledby="card-title"
    >
      {open && <CardBody />}
    </dialog>
  )
}

const toText = (list?: string[]) => (list ?? []).join('\n')
const toList = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

function CardBody() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const proc = project.processes[processId]
  const card = proc?.card ?? {}
  const [form, setForm] = useState({
    purpose: card.purpose ?? '',
    owner: card.owner ?? '',
    trigger: card.trigger ?? '',
    customer: card.customer ?? '',
    outputs: toText(card.outputs),
    metrics: toText(card.metrics),
    risks: toText(card.risks),
    checklist: toText(card.checklist),
  })
  const close = () => useUi.getState().setCardOpen(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const save = () => {
    const next: ProcessCard | undefined = sanitizeCard({
      purpose: form.purpose,
      owner: form.owner,
      trigger: form.trigger,
      customer: form.customer,
      outputs: toList(form.outputs),
      metrics: toList(form.metrics),
      risks: toList(form.risks),
      checklist: toList(form.checklist),
    })
    useStore.getState().dispatch({ type: 'updateProcess', id: processId, patch: { card: next } })
    close()
  }

  if (!proc) return null
  return (
    <>
      <div className="dialog__head">
        <h2 id="card-title">Prosessikortti: {proc.name}</h2>
        <button type="button" className="icon-btn" aria-label="Sulje" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <p className="field__hint">
        Prosessin perustiedot yhdellä silmäyksellä. Kortti näkyy dokumenttiviennissä ja
        PowerPoint-esityksen alussa. Tiedot voi myös kirjoittaa pikasyötteessä (:tarkoitus,
        :omistaja jne.).
      </p>
      <div className="card__grid">
        {(
          [
            ['purpose', 'Tarkoitus', 'Miksi prosessi on olemassa?'],
            ['owner', 'Omistaja', 'Rooli tai henkilö, joka vastaa prosessista'],
            ['trigger', 'Käynnistäjä', 'Mikä käynnistää prosessin?'],
            ['customer', 'Asiakas', 'Kenelle prosessi tuottaa arvoa?'],
          ] as const
        ).map(([k, label, ph]) => (
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
        {LISTS.map((l) => (
          <label key={l.key} className="field card__list">
            <span className="field__label">{l.label}</span>
            <textarea
              rows={4}
              value={form[l.key]}
              data-testid={`card-${l.key}`}
              onChange={(e) => set(l.key, e.target.value)}
            />
            <span className="field__hint">{l.hint}</span>
          </label>
        ))}
      </div>
      <div className="dialog__actions">
        <button type="button" onClick={close}>
          Peruuta
        </button>
        <button type="button" className="btn-primary" data-testid="card-save" onClick={save}>
          Tallenna
        </button>
      </div>
    </>
  )
}
