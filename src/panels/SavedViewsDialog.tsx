import { useEffect, useMemo, useRef, useState } from 'react'
import { createScenario, createView, decisionsOf, scenarioPath } from '../model/scenario'
import type { Scenario, SavedView } from '../model/types'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

/** Tallennetut näkymät ja skenaariopolut: esityksen ja PowerPointin rakennuspalikat. */
export function SavedViewsDialog() {
  const open = useUi((s) => s.savedViewsOpen)
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
      onClose={() => useUi.getState().setSavedViewsOpen(false)}
      aria-labelledby="saved-views-title"
    >
      {open && <Body />}
    </dialog>
  )
}

function ScenarioEditor({ editing, onDone }: { editing: Scenario | null; onDone: () => void }) {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const pid = editing?.processId ?? processId
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [choices, setChoices] = useState<Record<string, string>>(editing?.choices ?? {})
  const decisions = useMemo(() => decisionsOf(project, pid), [project, pid])
  const path = useMemo(() => scenarioPath(project, pid, choices), [project, pid, choices])

  const save = () => {
    const dispatch = useStore.getState().dispatch
    if (editing) {
      dispatch({
        type: 'updateScenario',
        id: editing.id,
        patch: {
          name: name.trim() || editing.name,
          description: description.trim() || undefined,
          choices,
        },
      })
    } else {
      dispatch({ type: 'addScenario', scenario: createScenario(pid, name, choices, description) })
    }
    onDone()
  }

  return (
    <div className="scenario-editor" data-testid="scenario-editor">
      <h4>
        {editing ? 'Muokkaa skenaariota' : 'Uusi skenaario'}: {project.processes[pid]?.name}
      </h4>
      <div className="versions__form">
        <label className="field">
          <span className="field__label">Nimi</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="esim. Luottoraja ylittyy"
          />
        </label>
        <label className="field">
          <span className="field__label">Kuvaus (valinnainen)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <span />
      </div>
      {decisions.length === 0 ? (
        <p className="muted">Prosessissa ei ole päätöksiä, joissa olisi valittavia haaroja.</p>
      ) : (
        <ul className="scenario-choices">
          {decisions.map(({ node, edges }) => (
            <li key={node.id}>
              <span className="scenario-choices__q">{node.label}</span>
              <select
                aria-label={`Haara: ${node.label}`}
                value={edges.find((e) => e.id === choices[node.id])?.id ?? edges[0].id}
                onChange={(e) => setChoices({ ...choices, [node.id]: e.target.value })}
              >
                {edges.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label || project.nodes[e.to]?.label || 'Haara'}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <p className="field__hint">
        Polku: {path.order.size} vaihetta{path.looped ? ', palaa jo käytyyn vaiheeseen' : ''}.
      </p>
      <div className="storage__actions">
        <button type="button" className="btn-primary" onClick={save} data-testid="scenario-save">
          {editing ? 'Tallenna muutokset' : 'Tallenna skenaario'}
        </button>
        <button type="button" onClick={onDone}>
          Peruuta
        </button>
      </div>
    </div>
  )
}

function Body() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const present = useUi((s) => s.present)
  const dispatch = useStore((s) => s.dispatch)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [focusSel, setFocusSel] = useState(false)
  const [scenarioId, setScenarioId] = useState('')
  const [editing, setEditing] = useState<Scenario | 'new' | null>(null)

  const views = project.views ?? []
  const scenarios = Object.values(project.scenarios ?? {})
  const close = () => useUi.getState().setSavedViewsOpen(false)

  const saveView = () => {
    const view = createView({
      name: name.trim() || `Näkymä ${views.length + 1}`,
      ...(note.trim() ? { note: note.trim() } : {}),
      processId,
      expand: present.expand,
      onlyConfirmed: present.onlyConfirmed,
      showMetrics: present.showMetrics,
      heat: present.heat,
      changes: present.changes,
      ...(scenarioId ? { scenarioId } : {}),
      ...(focusSel && selection.nodeIds.length ? { focusNodeIds: selection.nodeIds } : {}),
    })
    if (dispatch({ type: 'addView', view })) {
      setName('')
      setNote('')
    }
  }

  const present_ = (v: SavedView) => {
    useUi.getState().setPresentView(v.id)
    useUi.getState().setPresentScenario(v.scenarioId ?? null)
    useUi.getState().setPresentOptions({
      expand: v.expand,
      onlyConfirmed: v.onlyConfirmed,
      showMetrics: v.showMetrics,
      heat: v.heat,
      changes: v.changes,
    })
    if (project.processes[v.processId]) useStore.getState().setCurrentProcess(v.processId)
    useUi.getState().setPresenting(true)
    close()
  }

  return (
    <>
      <div className="dialog__head">
        <h2 id="saved-views-title">Näkymät ja skenaariot</h2>
        <button type="button" className="icon-btn" aria-label="Sulje" onClick={close}>
          <Icon name="x" />
        </button>
      </div>

      <section className="storage__section">
        <h3>Tallenna nykyinen näkymä</h3>
        <p className="field__hint">
          Näkymä muistaa prosessin, asettelun (alaprosessit auki, vain vahvistetut), lämpökartan ja
          halutessasi rajauksen valittuihin vaiheisiin sekä skenaariopolun. Esitys ja PowerPoint
          koostetaan näkymistä.
        </p>
        <form
          className="versions__form"
          onSubmit={(e) => {
            e.preventDefault()
            saveView()
          }}
        >
          <label className="field">
            <span className="field__label">Nimi</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Näkymä ${views.length + 1}`}
            />
          </label>
          <label className="field">
            <span className="field__label">Puhujan muistiinpano</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" data-testid="view-save">
            Tallenna näkymä
          </button>
        </form>
        <div className="storage__actions">
          <label className="check">
            <input
              type="checkbox"
              checked={focusSel}
              disabled={selection.nodeIds.length === 0}
              onChange={(e) => setFocusSel(e.target.checked)}
            />
            Rajaa valittuihin vaiheisiin ({selection.nodeIds.length})
          </label>
          <label className="check">
            Skenaario{' '}
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              aria-label="Korostettava skenaario"
            >
              <option value="">Ei</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="storage__section">
        <h3>Tallennetut näkymät ({views.length})</h3>
        {views.length === 0 ? (
          <p className="muted">Ei vielä näkymiä.</p>
        ) : (
          <ol className="backups" data-testid="view-list">
            {views.map((v, i) => {
              const missing = !project.processes[v.processId]
              return (
                <li className="backup" key={v.id} data-testid="view-row">
                  <div className="backup__info">
                    <strong>
                      {i + 1}. {v.name}
                    </strong>
                    <span className="muted">
                      {missing ? 'Prosessi puuttuu' : project.processes[v.processId].name}
                      {v.scenarioId && project.scenarios?.[v.scenarioId]
                        ? ` · skenaario ${project.scenarios[v.scenarioId].name}`
                        : ''}
                      {v.focusNodeIds?.length ? ` · rajaus ${v.focusNodeIds.length} vaihetta` : ''}
                      {v.note ? ` · ${v.note}` : ''}
                    </span>
                  </div>
                  <div className="backup__actions">
                    <button type="button" disabled={missing} onClick={() => present_(v)}>
                      Esitä
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Siirrä ylös: ${v.name}`}
                      disabled={i === 0}
                      onClick={() => dispatch({ type: 'moveView', id: v.id, index: i - 1 })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Siirrä alas: ${v.name}`}
                      disabled={i === views.length - 1}
                      onClick={() => dispatch({ type: 'moveView', id: v.id, index: i + 1 })}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const n = await useUi.getState().prompt({
                          title: 'Nimeä näkymä',
                          label: 'Nimi',
                          initial: v.name,
                          confirmLabel: 'Tallenna',
                        })
                        if (n) dispatch({ type: 'updateView', id: v.id, patch: { name: n } })
                      }}
                    >
                      Nimeä
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Poista näkymä ${v.name}`}
                      onClick={async () => {
                        const ok = await useUi.getState().ask({
                          title: `Poistetaanko näkymä “${v.name}”?`,
                          message: 'Voit kumota poiston (Ctrl+Z).',
                          confirmLabel: 'Poista',
                          danger: true,
                        })
                        if (ok) dispatch({ type: 'deleteView', id: v.id })
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section className="storage__section">
        <div className="storage__row">
          <h3>Skenaariopolut ({scenarios.length})</h3>
          {editing === null && (
            <button type="button" onClick={() => setEditing('new')} data-testid="scenario-new">
              Uusi skenaario…
            </button>
          )}
        </div>
        {editing !== null && (
          <ScenarioEditor
            editing={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
        {scenarios.length === 0 && editing === null ? (
          <p className="muted">
            Skenaario on polku päätösten läpi, esim. “luottoraja ylittyy”. Se korostetaan kaaviossa
            ja käydään läpi esityksessä.
          </p>
        ) : (
          <ul className="backups" data-testid="scenario-list">
            {scenarios.map((s) => (
              <li className="backup" key={s.id} data-testid="scenario-row">
                <div className="backup__info">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {project.processes[s.processId]?.name ?? 'Prosessi puuttuu'}
                    {s.description ? ` · ${s.description}` : ''}
                  </span>
                </div>
                <div className="backup__actions">
                  <button type="button" onClick={() => setEditing(s)}>
                    Muokkaa
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Poista skenaario ${s.name}`}
                    onClick={async () => {
                      const ok = await useUi.getState().ask({
                        title: `Poistetaanko skenaario “${s.name}”?`,
                        message: 'Voit kumota poiston (Ctrl+Z).',
                        confirmLabel: 'Poista',
                        danger: true,
                      })
                      if (ok) dispatch({ type: 'deleteScenario', id: s.id })
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
