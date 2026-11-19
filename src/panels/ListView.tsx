import { useMemo } from 'react'
import { flowOrder } from '../model/flow'
import { CONFIDENCE_LABELS, KIND_LABELS, type Confidence } from '../model/types'
import { addNode, deleteSelection, enterSubprocess, startProcessSkeleton } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

/** Prosessi luettavana ääriviivalistana: nopea tapa lukea ja muokata isoa prosessia. */
export function ListView() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const dispatch = useStore((s) => s.dispatch)
  const select = useStore((s) => s.select)
  const editId = useUi((s) => s.editNodeId)

  const rows = useMemo(() => flowOrder(project, processId), [project, processId])

  if (rows.length === 0) {
    return (
      <div className="canvas__empty canvas__empty--static">
        <h2>Tämä prosessi on vielä tyhjä</h2>
        <p>Lisää ensimmäinen vaihe tai luo valmis runko.</p>
        <div className="canvas__empty-actions">
          <button type="button" className="btn-primary" onClick={startProcessSkeleton}>
            Luo alku, vaihe ja loppu
          </button>
          <button type="button" onClick={() => addNode('step')}>
            Lisää yksi vaihe
          </button>
          <button type="button" onClick={() => useUi.getState().openQuick('add')}>
            Kirjoita tekstinä
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="listview" data-testid="listview">
      <table>
        <caption className="sr-only">Prosessin vaiheet</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Vaihe</th>
            <th scope="col">Rooli</th>
            <th scope="col">Järjestelmät</th>
            <th scope="col">Seuraava</th>
            <th scope="col">Varmuus</th>
            <th scope="col">
              <span className="sr-only">Toiminnot</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth, next, orphan }, i) => {
            const selected = selection.nodeIds.includes(node.id)
            return (
              <tr
                key={node.id}
                className={`${selected ? 'is-selected' : ''} ${orphan ? 'is-orphan' : ''}`}
                aria-selected={selected}
                onClick={() => select({ nodeIds: [node.id], edgeIds: [] })}
              >
                <td className="num">{i + 1}</td>
                <td>
                  <div className="cell-label" style={{ paddingLeft: depth * 18 }}>
                    <span
                      className={`kind-dot kind-dot--${node.kind}`}
                      title={KIND_LABELS[node.kind]}
                    />
                    {editId === node.id ? (
                      <input
                        autoFocus
                        defaultValue={node.label}
                        aria-label="Vaiheen nimi"
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== node.label)
                            dispatch({ type: 'updateNode', id: node.id, patch: { label: v } })
                          useUi.getState().setEditNode(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') {
                            e.currentTarget.value = node.label
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="linklike"
                        onDoubleClick={() => useUi.getState().setEditNode(node.id)}
                        onFocus={() => select({ nodeIds: [node.id], edgeIds: [] })}
                      >
                        {node.label || <em>Nimetön</em>}
                      </button>
                    )}
                  </div>
                  {orphan && <span className="tag tag--warn">Ei yhteyttä alkuun</span>}
                </td>
                <td>
                  {node.roleId ? (
                    project.entities[node.roleId]?.name
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td>
                  {node.systemIds.length ? (
                    node.systemIds.map((s) => project.entities[s]?.name).join(', ')
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td className="next">
                  {next.length === 0 ? (
                    <span className="muted">–</span>
                  ) : (
                    next.map((n) => (
                      <span key={n.id} className="next__item">
                        {n.label && <b>{n.label}: </b>}
                        {project.nodes[n.id]?.label}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  <select
                    aria-label={`Varmuus: ${node.label}`}
                    value={node.confidence}
                    onChange={(e) =>
                      dispatch({
                        type: 'updateNode',
                        id: node.id,
                        patch: { confidence: e.target.value as Confidence },
                      })
                    }
                  >
                    {(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map((c) => (
                      <option key={c} value={c}>
                        {CONFIDENCE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="row-actions">
                  {node.kind === 'subprocess' && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Avaa alaprosessi ${node.label}`}
                      onClick={() => enterSubprocess(node.id)}
                    >
                      <Icon name="enter" size={16} />
                    </button>
                  )}
                  {node.kind !== 'end' && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Lisää vaihe kohdan ${node.label} jälkeen`}
                      title="Lisää jälkeen"
                      onClick={(e) => {
                        e.stopPropagation()
                        addNode('step', node.id)
                      }}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Poista ${node.label}`}
                    title="Poista"
                    onClick={(e) => {
                      e.stopPropagation()
                      select({ nodeIds: [node.id], edgeIds: [] })
                      void deleteSelection()
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
