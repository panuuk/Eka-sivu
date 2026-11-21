import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlob, safeFilename } from '../export/download'
import { FeedbackError, feedbackOps, parseFeedback, type Feedback } from '../model/feedback'
import { parseProjectJson, projectToJson } from '../model/serialize'
import { mergeProjects, MergeError, planMerge, type MergeChange } from '../model/sync'
import type { Project } from '../model/types'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

/** Projektin siirto laitteiden välillä: jaa tiedostona ja yhdistä toisella laitteella muokattu versio. */
export function SyncDialog() {
  const open = useUi((s) => s.syncOpen)
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
      onClose={() => useUi.getState().setSyncOpen(false)}
      aria-labelledby="sync-title"
    >
      {open && <SyncBody />}
    </dialog>
  )
}

const KIND_LABEL: Record<MergeChange['kind'], string> = {
  'new-incoming': 'Uusi tiedostossa',
  'new-local': 'Vain tällä laitteella',
  changed: 'Eroaa',
  'deleted-in-incoming': 'Poistettu tiedostossa',
  'deleted-local': 'Poistettu tällä laitteella',
}

const COLLECTION_LABEL: Record<MergeChange['collection'], string> = {
  processes: 'prosessi',
  nodes: 'vaihe',
  edges: 'yhteys',
  entities: 'rooli/järjestelmä/tuotos',
  sources: 'lähde',
  questions: 'kysymys',
}

function SyncBody() {
  const project = useStore((s) => s.project)!
  const [incoming, setIncoming] = useState<Project | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Map<string, 'local' | 'incoming'>>(new Map())
  const [shared, setShared] = useState<string | null>(null)
  const close = () => useUi.getState().setSyncOpen(false)
  const [fb, setFb] = useState<Feedback | null>(null)
  const [fbError, setFbError] = useState<string | null>(null)
  const [fbPicked, setFbPicked] = useState<Set<string>>(new Set())

  const readFeedback = async (file: File | undefined) => {
    if (!file) return
    setFbError(null)
    try {
      const parsed = parseFeedback(await file.text())
      if (parsed.projectId !== project.id) {
        setFb(null)
        setFbError(
          `Palaute koskee toista projektia${parsed.projectName ? ` (“${parsed.projectName}”)` : ''}, joten sitä ei voi tuoda tähän.`,
        )
        return
      }
      setFb(parsed)
      setFbPicked(new Set(parsed.items.map((i) => i.id)))
    } catch (e) {
      setFb(null)
      setFbError(e instanceof FeedbackError ? e.message : 'Palautteen lukeminen epäonnistui')
    }
  }
  const addFeedback = () => {
    if (!fb) return
    const ops = feedbackOps(project, fb, fbPicked)
    if (ops.length > 0) useStore.getState().dispatch(ops)
    useUi.getState().showRight('questions')
    close()
  }

  const plan = useMemo(
    () => (incoming && incoming.id === project.id ? planMerge(project, incoming) : null),
    [project, incoming],
  )
  const decisions = plan?.changes.filter(
    (c) => c.kind === 'changed' || c.kind.startsWith('deleted'),
  )

  const share = async () => {
    const text = projectToJson(project)
    const name = `${safeFilename(project.name)}.prosessikartta.json`
    const file = new File([text], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: project.name })
        setShared('Jaettu.')
        return
      }
    } catch (e) {
      // Käyttäjä peruutti jakamisen: ei virhettä
      if ((e as Error).name === 'AbortError') return
    }
    downloadBlob(file, name)
    setShared('Tiedosto ladattiin. Siirrä se toiselle laitteelle (sähköposti, Drive, Teams).')
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setChoices(new Map())
    try {
      const parsed = parseProjectJson(await file.text())
      setIncoming(parsed)
      setFileName(file.name)
    } catch (e) {
      setIncoming(null)
      setError((e as Error).message)
    }
  }

  const apply = () => {
    if (!incoming) return
    try {
      const merged = mergeProjects(project, incoming, choices)
      useStore.getState().applyMerged(merged)
      close()
    } catch (e) {
      setError(
        e instanceof MergeError ? e.message : `Yhdistäminen epäonnistui: ${(e as Error).message}`,
      )
    }
  }

  const different = incoming && incoming.id !== project.id
  const nothing = plan && plan.changes.every((c) => c.kind === 'new-local') && !decisions?.length

  return (
    <>
      <div className="dialog__head">
        <h2 id="sync-title">Jaa ja yhdistä</h2>
        <button type="button" className="icon-btn" aria-label="Sulje" onClick={close}>
          <Icon name="x" />
        </button>
      </div>

      <section className="storage__section">
        <h3>Jaa projekti toiselle laitteelle</h3>
        <p className="field__hint">
          Projekti siirtyy tiedostona. Puhelimella jakovalikko tarjoaa sähköpostin, Driven ja
          Teamsin. Muualla tiedosto ladataan, ja voit siirtää sen itse. Mitään ei lähetetä
          palvelimelle.
        </p>
        <button
          type="button"
          className="btn-primary"
          data-testid="sync-share"
          onClick={() => void share()}
        >
          <Icon name="upload" size={16} /> Jaa projekti
        </button>
        {shared && (
          <p className="field__hint" role="status">
            {shared}
          </p>
        )}
      </section>

      <section className="storage__section">
        <h3>Yhdistä toisella laitteella muokattu versio</h3>
        <p className="field__hint">
          Valitse toiselta laitteelta siirretty projektitiedosto. Kummankin laitteen lisäykset
          säilyvät. Jos sama asia on muuttunut molemmilla, uudempi muutos voittaa, ja voit vaihtaa
          valinnan. Yhdistäminen on kumottavissa.
        </p>
        <label className="btn-like">
          <input
            type="file"
            hidden
            accept=".json,application/json"
            data-testid="sync-file"
            onChange={(e) => {
              void readFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Icon name="upload" size={16} /> Valitse tiedosto…
        </label>
        {error && <p className="issue issue--error">{error}</p>}
        {different && incoming && (
          <div className="issue issue--warning" data-testid="sync-other-project">
            <p>
              Tiedosto on eri projekti (“{incoming.name}”), joten sitä ei voi yhdistää tähän. Voit
              tuoda sen omana projektinaan.
            </p>
            <button
              type="button"
              onClick={async () => {
                await useStore.getState().importProjectJson(projectToJson(incoming))
                close()
              }}
            >
              Tuo uutena projektina
            </button>
          </div>
        )}
        {plan && incoming && (
          <div className="sync__plan" data-testid="sync-plan">
            <p>
              <strong>{fileName}</strong>:{' '}
              {plan.counts['new-incoming'] > 0
                ? `${plan.counts['new-incoming']} uutta tietuetta tiedostosta`
                : 'ei uusia tietueita'}
              {plan.counts.changed > 0 ? `, ${plan.counts.changed} eroavaa` : ''}
              {plan.counts['deleted-in-incoming'] + plan.counts['deleted-local'] > 0
                ? `, ${plan.counts['deleted-in-incoming'] + plan.counts['deleted-local']} poistoa`
                : ''}
              {plan.counts['new-local'] > 0
                ? `. ${plan.counts['new-local']} tietuetta on vain tällä laitteella ja säilyy.`
                : '.'}
            </p>
            {nothing && <p className="muted">Tiedosto ei tuo mitään uutta.</p>}
            {decisions && decisions.length > 0 && (
              <table className="sync__table" aria-label="Erot">
                <thead>
                  <tr>
                    <th scope="col">Tietue</th>
                    <th scope="col">Ero</th>
                    <th scope="col">Käytetään</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.slice(0, 200).map((c) => {
                    const value = choices.get(c.id) ?? c.winner
                    const set = (v: 'local' | 'incoming') =>
                      setChoices((prev) => new Map(prev).set(c.id, v))
                    return (
                      <tr key={c.id}>
                        <th scope="row">
                          {c.label}{' '}
                          <span className="muted">({COLLECTION_LABEL[c.collection]})</span>
                        </th>
                        <td>{KIND_LABEL[c.kind]}</td>
                        <td>
                          <select
                            aria-label={`Käytettävä versio: ${c.label}`}
                            value={value}
                            onChange={(e) => set(e.target.value as 'local' | 'incoming')}
                          >
                            <option value="local">
                              {c.kind === 'deleted-in-incoming' ? 'Säilytä' : 'Tämän laitteen'}
                            </option>
                            <option value="incoming">
                              {c.kind === 'deleted-in-incoming' ? 'Poista' : 'Tiedoston'}
                            </option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div className="dialog__actions">
              <button type="button" onClick={close}>
                Peruuta
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="sync-apply"
                disabled={nothing === true}
                onClick={apply}
              >
                Yhdistä
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="storage__section">
        <h3>Tuo katselmointipalaute</h3>
        <p className="field__hint">
          Vie projekti HTML-tiedostona palautetilassa (Vie → HTML → Palautetila) ja lähetä se
          lukijalle. Lukija kommentoi vaiheita ja vastaa avoimiin kysymyksiin selaimessa ja
          tallentaa palautteen tiedostoksi. Tuo tiedosto tähän: valitsemistasi riveistä tulee
          avoimia kysymyksiä oikeisiin vaiheisiin.
        </p>
        <label className="btn-like">
          <input
            type="file"
            hidden
            accept=".json,application/json"
            data-testid="feedback-file"
            onChange={(e) => {
              void readFeedback(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Icon name="upload" size={16} /> Valitse palautetiedosto…
        </label>
        {fbError && <p className="issue issue--error">{fbError}</p>}
        {fb && (
          <div data-testid="feedback-plan">
            <p>
              <strong>{fb.reviewer || 'Nimetön lukija'}</strong>: {fb.items.length} kommenttia ja
              vastausta.
            </p>
            <ul className="effects">
              {fb.items.map((i) => (
                <li key={i.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={fbPicked.has(i.id)}
                      aria-label={`Ota mukaan: ${i.text.slice(0, 40)}`}
                      onChange={() =>
                        setFbPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(i.id)) next.delete(i.id)
                          else next.add(i.id)
                          return next
                        })
                      }
                    />
                    <span className="badge">{i.type === 'answer' ? 'Vastaus' : 'Kommentti'}</span>
                    {i.nodeLabel && <b>{i.nodeLabel}: </b>}
                    {i.type === 'answer' && i.questionText ? `${i.questionText} → ` : ''}
                    {i.text}
                  </label>
                </li>
              ))}
            </ul>
            <div className="dialog__actions">
              <button
                type="button"
                className="btn-primary"
                data-testid="feedback-apply"
                disabled={fbPicked.size === 0}
                onClick={addFeedback}
              >
                Lisää kysymyksiksi ({fbPicked.size})
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
