import { useMemo, useState } from 'react'
import { filterActive, matchNodes, searchHits } from '../analysis/search'
import { useAnalysis } from '../analysis/useAnalysis'
import { entitiesOfKind } from '../model/selectors'
import { CONFIDENCE_LABELS, type Confidence } from '../model/types'
import { goToNode } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

/** Haku ja suodattimet. Osumat näytetään listana, ja kaavio himmentää ei-osuvat vaiheet. */
export function FilterBar({ className = '' }: { className?: string }) {
  const project = useStore((s) => s.project)!
  const filter = useUi((s) => s.filter)
  const analysis = useAnalysis()
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)
  const active = filterActive(filter)

  const openIds = useMemo(() => new Set(analysis.perNode.keys()), [analysis.perNode])
  const hits = useMemo(
    () => (filter.text.trim() ? searchHits(project, filter, openIds, 30) : []),
    [project, filter, openIds],
  )
  const matchCount = useMemo(
    () =>
      active
        ? matchNodes(project, filter, openIds).filter((n) => n.kind !== 'start' && n.kind !== 'end')
            .length
        : 0,
    [project, filter, openIds, active],
  )
  const total = useMemo(
    () => Object.values(project.nodes).filter((n) => n.kind !== 'start' && n.kind !== 'end').length,
    [project.nodes],
  )
  const set = useUi.getState().setFilter

  return (
    <div className={`filterbar ${className}`} role="search">
      <div className="filterbar__row">
        <div className="filterbar__search">
          <Icon name="search" size={16} />
          <input
            id="global-search"
            type="search"
            aria-label="Hae vaiheita"
            placeholder="Hae vaiheita…  ( / )"
            value={filter.text}
            autoComplete="off"
            onChange={(e) => set({ text: e.target.value })}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) goToNode(hits[0].node.id)
              if (e.key === 'Escape') {
                if (filter.text) set({ text: '' })
                else (e.target as HTMLInputElement).blur()
              }
            }}
          />
        </div>
        <button
          type="button"
          className={`filterbar__toggle ${expanded || filter.roleId || filter.systemId || filter.confidence || filter.openOnly ? 'is-on' : ''}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          Suodattimet
        </button>
        {active && (
          <>
            <span className="filterbar__count" role="status">
              {matchCount} / {total}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Tyhjennä haku ja suodattimet"
              onClick={() => useUi.getState().clearFilter()}
            >
              <Icon name="x" size={16} />
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="filterbar__filters">
          <label>
            <span className="field__label">Rooli</span>
            <select
              value={filter.roleId ?? ''}
              onChange={(e) => set({ roleId: e.target.value || undefined })}
            >
              <option value="">Kaikki</option>
              {entitiesOfKind(project, 'role').map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field__label">Järjestelmä</span>
            <select
              value={filter.systemId ?? ''}
              onChange={(e) => set({ systemId: e.target.value || undefined })}
            >
              <option value="">Kaikki</option>
              {entitiesOfKind(project, 'system').map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field__label">Varmuus</span>
            <select
              value={filter.confidence ?? ''}
              onChange={(e) =>
                set({ confidence: (e.target.value || undefined) as Confidence | undefined })
              }
            >
              <option value="">Kaikki</option>
              {(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map((c) => (
                <option key={c} value={c}>
                  {CONFIDENCE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!filter.openOnly}
              onChange={(e) => set({ openOnly: e.target.checked || undefined })}
            />
            Avoimet kysymykset
          </label>
        </div>
      )}

      {focused && hits.length > 0 && (
        <ul className="filterbar__results" role="listbox" aria-label="Hakutulokset">
          {hits.map((h) => (
            <li key={h.node.id} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  goToNode(h.node.id)
                }}
              >
                <strong>{h.node.label}</strong>
                <span className="muted">
                  {project.processes[h.node.processId]?.name}
                  {h.where.length ? ` · ${h.where.join(', ')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
