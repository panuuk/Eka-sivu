import { useState } from 'react'
import {
  opsAddBranch,
  opsAddEnd,
  opsAddStart,
  opsConnect,
  opsConnectToEnd,
  opsDismissGap,
  opsMergeNodes,
} from '../analysis/fixes'
import type { Gap } from '../analysis/gaps'
import { nodesOf, outgoing } from '../model/selectors'
import type { Operation } from '../model/operations'
import type { Project } from '../model/types'
import { enterSubprocess } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { ChipPicker } from '../ui/ChipPicker'

const dispatch = (ops: Operation[]) => useStore.getState().dispatch(ops)

function NodeSelect({
  label,
  project,
  processId,
  exclude,
  value,
  onChange,
}: {
  label: string
  project: Project
  processId: string
  exclude: string[]
  value: string
  onChange: (id: string) => void
}) {
  const options = nodesOf(project, processId).filter((n) => !exclude.includes(n.id))
  return (
    <label className="gap-select">
      <span className="field__label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Valitse vaihe…</option>
        {options.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label || 'Nimetön'}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Vastauslomake aukon korjaamiseen. Jokainen toiminto on tavallinen, kumottava muutos malliin. */
export function GapAnswer({ gap, project }: { gap: Gap; project: Project }) {
  const [pick, setPick] = useState('')
  const [text, setText] = useState('')
  const [labels, setLabels] = useState<Record<string, string>>({})

  const dismiss = (text = 'Ohita') => (
    <button type="button" className="linklike" onClick={() => dispatch(opsDismissGap(gap))}>
      {text}
    </button>
  )

  switch (gap.rule) {
    case 'no-role':
      return (
        <div className="gap-answer">
          <ChipPicker
            kind="role"
            label="Vastuurooli"
            single
            value={[]}
            placeholder="Valitse tai luo rooli…"
            onChange={(ids, ops) =>
              dispatch([
                ...ops,
                { type: 'updateNode', id: gap.targetId!, patch: { roleId: ids[0] } },
              ])
            }
          />
          {dismiss()}
        </div>
      )

    case 'decision-branches': {
      const exclude = [gap.targetId!, ...outgoing(project, gap.targetId!).map((e) => e.to)]
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <input
              aria-label="Uuden haaran vaihe"
              placeholder="Mitä muussa tapauksessa tehdään?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!text.trim()}
              onClick={() => {
                const r = opsAddBranch(project, gap.targetId!, text)
                if (r) dispatch(r.ops)
              }}
            >
              Lisää haara
            </button>
          </div>
          <div className="gap-row">
            <NodeSelect
              label="tai yhdistä olemassa olevaan"
              project={project}
              processId={gap.processId}
              exclude={exclude}
              value={pick}
              onChange={setPick}
            />
            <button
              type="button"
              disabled={!pick}
              onClick={() => {
                const used = new Set(outgoing(project, gap.targetId!).map((e) => e.label))
                const label = ['Kyllä', 'Ei'].find((l) => !used.has(l))
                dispatch(opsConnect(project, gap.targetId!, pick, label))
              }}
            >
              Yhdistä
            </button>
          </div>
          {dismiss('Päätöksellä on tarkoituksella yksi haara')}
        </div>
      )
    }

    case 'decision-labels': {
      const edgeIds = (gap.data?.edgeIds as string[]) ?? []
      const defaults = ['Kyllä', 'Ei']
      return (
        <div className="gap-answer">
          {edgeIds.map((id, i) => {
            const e = project.edges[id]
            if (!e) return null
            return (
              <label key={id} className="gap-select">
                <span className="field__label">→ {project.nodes[e.to]?.label}</span>
                <input
                  value={labels[id] ?? ''}
                  placeholder={defaults[i] ?? 'Haaran nimi'}
                  onChange={(ev) => setLabels((l) => ({ ...l, [id]: ev.target.value }))}
                />
              </label>
            )
          })}
          <button
            type="button"
            className="btn-primary"
            disabled={!edgeIds.some((id) => labels[id]?.trim())}
            onClick={() =>
              dispatch(
                edgeIds
                  .filter((id) => labels[id]?.trim())
                  .map((id): Operation => ({
                    type: 'updateEdge',
                    id,
                    patch: { label: labels[id].trim() },
                  })),
              )
            }
          >
            Tallenna nimet
          </button>
        </div>
      )
    }

    case 'unreachable':
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <NodeSelect
              label="Tullaan vaiheesta"
              project={project}
              processId={gap.processId}
              exclude={[gap.targetId!]}
              value={pick}
              onChange={setPick}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!pick}
              onClick={() => dispatch(opsConnect(project, pick, gap.targetId!))}
            >
              Yhdistä
            </button>
          </div>
          {dismiss()}
        </div>
      )

    case 'dead-end':
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <NodeSelect
              label="Jatkuu vaiheeseen"
              project={project}
              processId={gap.processId}
              exclude={[gap.targetId!]}
              value={pick}
              onChange={setPick}
            />
            <button
              type="button"
              disabled={!pick}
              onClick={() => dispatch(opsConnect(project, gap.targetId!, pick))}
            >
              Yhdistä
            </button>
          </div>
          <div className="gap-row">
            <button
              type="button"
              className="btn-primary"
              onClick={() => dispatch(opsConnectToEnd(project, gap.targetId!))}
            >
              Tämä päättää prosessin
            </button>
            {dismiss()}
          </div>
        </div>
      )

    case 'no-start':
      return (
        <div className="gap-answer">
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch(opsAddStart(project, gap.processId))}
          >
            Lisää alkupiste
          </button>
          {dismiss()}
        </div>
      )

    case 'no-end':
      return (
        <div className="gap-answer">
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch(opsAddEnd(project, gap.processId))}
          >
            Lisää loppupiste
          </button>
          {dismiss()}
        </div>
      )

    case 'artifact-source': {
      const steps = Object.values(project.nodes).filter(
        (n) => (n.kind === 'step' || n.kind === 'subprocess') && n.id !== gap.targetId,
      )
      return (
        <div className="gap-answer">
          <label className="gap-select">
            <span className="field__label">Tuottaa vaihe</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Valitse vaihe…</option>
              {steps.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({project.processes[n.processId]?.name})
                </option>
              ))}
            </select>
          </label>
          <div className="gap-row">
            <button
              type="button"
              className="btn-primary"
              disabled={!pick}
              onClick={() => {
                const n = project.nodes[pick]
                if (n && gap.entityId && !n.outputIds.includes(gap.entityId)) {
                  dispatch([
                    {
                      type: 'updateNode',
                      id: pick,
                      patch: { outputIds: [...n.outputIds, gap.entityId] },
                    },
                  ])
                }
              }}
            >
              Merkitse tuotokseksi
            </button>
            {dismiss('Tulee prosessin ulkopuolelta')}
          </div>
        </div>
      )
    }

    case 'guess-unsourced':
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <button
              type="button"
              onClick={() =>
                dispatch([
                  { type: 'updateNode', id: gap.targetId!, patch: { confidence: 'likely' } },
                ])
              }
            >
              Todennäköinen
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                dispatch([
                  { type: 'updateNode', id: gap.targetId!, patch: { confidence: 'confirmed' } },
                ])
              }
            >
              Vahvista
            </button>
          </div>
          <div className="gap-row">
            <button
              type="button"
              className="linklike"
              onClick={() => useUi.getState().setView('sources')}
            >
              Etsi lähteistä
            </button>
            {dismiss()}
          </div>
        </div>
      )

    case 'source-conflict': {
      const other = gap.entityId ? project.entities[gap.entityId] : undefined
      return (
        <div className="gap-answer">
          {typeof gap.data?.quote === 'string' && <q className="gap-quote">{gap.data.quote}</q>}
          <div className="gap-row">
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                dispatch([
                  { type: 'updateNode', id: gap.targetId!, patch: { roleId: gap.entityId } },
                ])
              }
            >
              Käytä roolia “{other?.name}”
            </button>
            {dismiss('Pidä nykyinen')}
          </div>
        </div>
      )
    }

    case 'empty-subprocess':
      return (
        <div className="gap-answer">
          <button
            type="button"
            className="btn-primary"
            onClick={() => enterSubprocess(gap.targetId!)}
          >
            Avaa alaprosessi
          </button>
          {dismiss()}
        </div>
      )

    case 'duplicate-label': {
      const otherId = gap.data?.otherId as string | undefined
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <button
              type="button"
              className="btn-primary"
              disabled={!otherId}
              onClick={() => otherId && dispatch(opsMergeNodes(project, otherId, gap.targetId!))}
            >
              Yhdistä yhdeksi vaiheeksi
            </button>
            {dismiss('Ovat eri vaiheita')}
          </div>
        </div>
      )
    }

    case 'no-label':
      return (
        <div className="gap-answer">
          <div className="gap-row">
            <input
              aria-label="Vaiheen nimi"
              placeholder="Anna nimi"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!text.trim()}
              onClick={() =>
                dispatch([{ type: 'updateNode', id: gap.targetId!, patch: { label: text.trim() } }])
              }
            >
              Tallenna
            </button>
          </div>
        </div>
      )
  }
}
