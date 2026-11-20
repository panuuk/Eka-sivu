import { refIsStale } from '../capture/refs'
import { opsExpandNode } from '../model/commands'
import type { NodePatch, Operation } from '../model/operations'
import { edgesOf, nodesOf } from '../model/selectors'
import {
  CONFIDENCE_LABELS,
  KIND_LABELS,
  type Confidence,
  type NodeKind,
  type ProcessNode,
} from '../model/types'
import { deleteSelection, enterSubprocess, groupSelection } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { ChipPicker } from '../ui/ChipPicker'
import { Icon } from '../ui/Icon'
import { Segmented, TextField } from './fields'
import { ReadinessCard } from './QuestionsPanel'

const KINDS: NodeKind[] = ['step', 'decision', 'subprocess', 'start', 'end']

function NodeInspector({ node }: { node: ProcessNode }) {
  const dispatch = useStore((s) => s.dispatch)
  const project = useStore((s) => s.project)!
  const id = node.id

  const patch = (p: NodePatch, extra: Operation[] = [], key?: string) =>
    dispatch(
      [...extra, { type: 'updateNode', id, patch: p }],
      key ? { coalesceKey: `${key}:${id}` } : {},
    )

  const changeKind = (kind: NodeKind) => {
    if (kind === node.kind) return
    if (node.childProcessId && kind !== 'subprocess') {
      useStore
        .getState()
        .setError('Alaprosessillinen vaihe pysyy alaprosessina. Poista alaprosessi ensin.')
      return
    }
    if (kind === 'subprocess') {
      const { ops } = opsExpandNode(project, id)
      dispatch(ops)
      return
    }
    patch({ kind })
  }

  const outCount = edgesOf(project, node.processId).filter((e) => e.from === id).length
  const sourceRefs = node.sources.filter((s) => project.sources[s.sourceId])

  return (
    <div className="inspector__body" data-testid="inspector-node">
      <TextField
        label="Nimi"
        value={node.label}
        onChange={(v) => patch({ label: v }, [], 'label')}
      />

      <div className="field">
        <label className="field__label" htmlFor="kind-select">
          Tyyppi
        </label>
        <select
          id="kind-select"
          value={node.kind}
          onChange={(e) => changeKind(e.target.value as NodeKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <Segmented<Confidence>
        label="Varmuus"
        value={node.confidence}
        options={(['guess', 'likely', 'confirmed'] as Confidence[]).map((c) => ({
          value: c,
          label: CONFIDENCE_LABELS[c],
        }))}
        onChange={(c) => patch({ confidence: c })}
      />

      {node.kind !== 'start' && node.kind !== 'end' && (
        <>
          <ChipPicker
            kind="role"
            label="Vastuu (rooli)"
            single
            value={node.roleId ? [node.roleId] : []}
            placeholder="Kuka tekee?"
            onChange={(ids, ops) => patch({ roleId: ids[0] }, ops)}
          />
          <ChipPicker
            kind="system"
            label="Järjestelmät"
            value={node.systemIds}
            onChange={(ids, ops) => patch({ systemIds: ids }, ops)}
          />
          <ChipPicker
            kind="artifact"
            label="Syötteet"
            value={node.inputIds}
            placeholder="Mitä tarvitaan?"
            onChange={(ids, ops) => patch({ inputIds: ids }, ops)}
          />
          <ChipPicker
            kind="artifact"
            label="Tuotokset"
            value={node.outputIds}
            placeholder="Mitä syntyy?"
            onChange={(ids, ops) => patch({ outputIds: ids }, ops)}
          />
        </>
      )}

      <TextField
        label="Kuvaus"
        multiline
        value={node.description ?? ''}
        onChange={(v) => patch({ description: v || undefined }, [], 'desc')}
      />
      <TextField
        label="Muistiinpanot"
        multiline
        rows={2}
        value={node.notes ?? ''}
        onChange={(v) => patch({ notes: v || undefined }, [], 'notes')}
      />

      {node.kind === 'decision' && outCount < 2 && (
        <p className="inspector__warn">
          <Icon name="warn" size={14} /> Päätöksellä pitäisi olla vähintään kaksi haaraa.
        </p>
      )}

      {sourceRefs.length > 0 && (
        <div className="field">
          <span className="field__label">Lähteet</span>
          <ul className="source-list">
            {sourceRefs.map((s, i) => {
              const src = project.sources[s.sourceId]
              const stale = refIsStale(src, s)
              return (
                <li key={i}>
                  <strong>{src.title}</strong>
                  <q>{s.quote.length > 140 ? `${s.quote.slice(0, 140)}…` : s.quote}</q>
                  {stale ? (
                    <span className="muted">Lähdettä on muokattu, kohtaa ei löydy enää.</span>
                  ) : (
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => useUi.getState().focusSourceRef(s.sourceId, s.start, s.end)}
                    >
                      Avaa lähteessä
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="inspector__actions">
        {node.kind === 'subprocess' && (
          <button type="button" onClick={() => enterSubprocess(id)}>
            <Icon name="enter" size={16} /> Avaa alaprosessi
          </button>
        )}
        {node.locked && (
          <button type="button" onClick={() => patch({ locked: undefined, position: undefined })}>
            <Icon name="unlock" size={16} /> Vapauta sijainti
          </button>
        )}
        <button type="button" className="btn-danger-ghost" onClick={() => void deleteSelection()}>
          <Icon name="trash" size={16} /> Poista
        </button>
      </div>
    </div>
  )
}

function EdgeInspector({ edgeId }: { edgeId: string }) {
  const project = useStore((s) => s.project)!
  const dispatch = useStore((s) => s.dispatch)
  const edge = project.edges[edgeId]
  if (!edge) return null
  const from = project.nodes[edge.from]
  const to = project.nodes[edge.to]
  return (
    <div className="inspector__body" data-testid="inspector-edge">
      <p className="inspector__edge">
        <strong>{from?.label}</strong> → <strong>{to?.label}</strong>
      </p>
      <TextField
        label="Haaran nimi"
        value={edge.label ?? ''}
        placeholder={from?.kind === 'decision' ? 'esim. Kyllä' : 'valinnainen'}
        onChange={(v) =>
          dispatch(
            { type: 'updateEdge', id: edgeId, patch: { label: v || undefined } },
            { coalesceKey: `edge:${edgeId}` },
          )
        }
      />
      <div className="inspector__actions">
        <button type="button" className="btn-danger-ghost" onClick={() => void deleteSelection()}>
          <Icon name="trash" size={16} /> Poista yhteys
        </button>
      </div>
    </div>
  )
}

function ProcessInspector() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const dispatch = useStore((s) => s.dispatch)
  const proc = project.processes[processId]
  if (!proc) return null
  const n = nodesOf(project, processId)
  return (
    <div className="inspector__body">
      <TextField
        label="Prosessin nimi"
        value={proc.name}
        onChange={(v) =>
          dispatch(
            { type: 'updateProcess', id: processId, patch: { name: v } },
            { coalesceKey: `proc:${processId}` },
          )
        }
      />
      <TextField
        label="Kuvaus"
        multiline
        value={proc.description ?? ''}
        onChange={(v) =>
          dispatch(
            { type: 'updateProcess', id: processId, patch: { description: v || undefined } },
            { coalesceKey: `procd:${processId}` },
          )
        }
      />
      <ReadinessCard processId={processId} />
      <dl className="stats">
        <div>
          <dt>Vaiheita</dt>
          <dd>{n.filter((x) => x.kind === 'step' || x.kind === 'subprocess').length}</dd>
        </div>
        <div>
          <dt>Päätöksiä</dt>
          <dd>{n.filter((x) => x.kind === 'decision').length}</dd>
        </div>
        <div>
          <dt>Vahvistettu</dt>
          <dd>
            {n.filter((x) => x.confidence === 'confirmed').length}/{n.length}
          </dd>
        </div>
      </dl>
      <p className="inspector__hint">Valitse vaihe tai yhteys kaaviosta muokataksesi sitä.</p>
    </div>
  )
}

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const project = useStore((s) => s.project)!

  let title = 'Prosessi'
  let content
  if (selection.nodeIds.length === 1 && selection.edgeIds.length === 0) {
    const node = project.nodes[selection.nodeIds[0]]
    title = node ? KIND_LABELS[node.kind] : 'Vaihe'
    content = node ? <NodeInspector key={node.id} node={node} /> : null
  } else if (selection.edgeIds.length === 1 && selection.nodeIds.length === 0) {
    title = 'Yhteys'
    content = <EdgeInspector key={selection.edgeIds[0]} edgeId={selection.edgeIds[0]} />
  } else if (selection.nodeIds.length + selection.edgeIds.length > 1) {
    title = 'Useita valittu'
    content = (
      <div className="inspector__body">
        <p>
          {selection.nodeIds.length} vaihetta ja {selection.edgeIds.length} yhteyttä valittu.
        </p>
        <div className="inspector__actions">
          <button type="button" onClick={groupSelection} disabled={selection.nodeIds.length < 2}>
            <Icon name="group" size={16} /> Ryhmitä alaprosessiksi
          </button>
          <button type="button" className="btn-danger-ghost" onClick={() => void deleteSelection()}>
            <Icon name="trash" size={16} /> Poista valitut
          </button>
        </div>
      </div>
    )
  } else {
    content = <ProcessInspector />
  }

  return (
    <aside className="inspector" aria-label="Ominaisuudet">
      <h2 className="panel__title">{title}</h2>
      {content}
    </aside>
  )
}
