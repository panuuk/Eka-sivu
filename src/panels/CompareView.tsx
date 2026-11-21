import { useEffect, useMemo, useState } from 'react'
import { compareProjects, type Comparison, type NodeChange } from '../analysis/compare'
import { pickBaseline, projectFromSnapshot } from '../model/commands'
import { formatTotal } from '../model/duration'
import type { Project } from '../model/types'
import { buildGraph, currentRequest, svgOptions } from '../export/run'
import { renderSvg } from '../export/svg'
import { goToNode } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'

type Tab = 'list' | 'diagrams'

const KIND_LABEL = { added: 'Lisätty', removed: 'Poistettu', changed: 'Muuttunut' } as const

function Delta({
  a,
  b,
  fmt = String,
  lowerIsBetter = true,
}: {
  a?: number
  b?: number
  fmt?: (n: number) => string
  lowerIsBetter?: boolean
}) {
  if (a === undefined && b === undefined) return <span className="muted">–</span>
  const diff = (b ?? 0) - (a ?? 0)
  const good = diff === 0 ? null : lowerIsBetter ? diff < 0 : diff > 0
  return (
    <>
      {a !== undefined ? fmt(a) : '–'} → <strong>{b !== undefined ? fmt(b) : '–'}</strong>
      {diff !== 0 && (
        <span className={`delta delta--${good ? 'good' : 'bad'}`}>
          {' '}
          ({diff > 0 ? '+' : ''}
          {fmt(diff)})
        </span>
      )}
    </>
  )
}

function useSide(project: Project, id: string | 'current'): Project | null {
  return useMemo(() => {
    if (id === 'current') return project
    const v = project.versions?.[id]
    return v ? projectFromSnapshot(project, v.snapshot) : null
  }, [project, id])
}

function NodeChangeRow({ c, canGo }: { c: NodeChange; canGo: boolean }) {
  return (
    <li className={`change change--${c.kind}`} data-testid="change-row">
      <div className="change__head">
        <span className="change__kind">{KIND_LABEL[c.kind]}</span>
        {canGo && c.targetId ? (
          <button type="button" className="linklike" onClick={() => goToNode(c.targetId!)}>
            {c.label || 'Nimetön'}
          </button>
        ) : (
          <strong>{c.label || 'Nimetön'}</strong>
        )}
        <span className="muted"> · {c.processName}</span>
        {c.matchedByLabel && (
          <span className="muted"> · tunnistettu samaksi nimen perusteella</span>
        )}
      </div>
      {c.fields.length > 0 && (
        <ul className="change__fields">
          {c.fields.map((f) => (
            <li key={f.field}>
              <span className="muted">{f.label}:</span> <del>{f.before}</del> → <ins>{f.after}</ins>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function DiagramPane({
  title,
  project,
  marks,
  expand,
}: {
  title: string
  project: Project
  marks: Comparison['baseMarks']
  expand: boolean
}) {
  const theme = useUi((s) => s.theme)
  const options = useUi((s) => s.present)
  const direction = useUi((s) => s.direction)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const rootId = project.rootProcessId

  useEffect(() => {
    let cancelled = false
    const base = currentRequest(project, rootId)
    const req = { ...base, options: { ...base.options, expand }, direction }
    buildGraph(req, { expand })
      .then((g) => {
        if (cancelled) return
        setSvg(renderSvg(g, { ...svgOptions(req, title), marks, showUncertainty: false, title }))
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // theme ja options vaikuttavat ulkoasuun
  }, [project, rootId, expand, direction, marks, title, theme, options])

  return (
    <figure className="comparepane">
      <figcaption>{title}</figcaption>
      {error ? (
        <p className="muted">{error}</p>
      ) : (
        // SVG on oma tuotoksemme: kaikki käyttäjän tekstit on escapettu renderSvg:ssä.
        <div className="comparepane__svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </figure>
  )
}

/** Vertailu: nykytila ja tavoitetila (tai mitkä tahansa kaksi versiota) kaaviona ja muutosluettelona. */
export function CompareView() {
  const project = useStore((s) => s.project)!
  const baseId = useUi((s) => s.compareBaseId)
  const targetId = useUi((s) => s.compareTargetId)
  const [tab, setTab] = useState<Tab>('list')
  const [expand, setExpand] = useState(true)

  const versions = useMemo(
    () => Object.values(project.versions ?? {}).sort((a, b) => b.createdAt - a.createdAt),
    [project.versions],
  )
  const effectiveBase =
    baseId && project.versions?.[baseId] ? baseId : (pickBaseline(project)?.id ?? null)
  const base = useSide(project, effectiveBase ?? 'current')
  const target = useSide(project, project.versions?.[targetId] ? targetId : 'current')

  const cmp = useMemo(
    () => (effectiveBase && base && target ? compareProjects(base, target) : null),
    [effectiveBase, base, target],
  )

  if (versions.length === 0 || !effectiveBase || !base || !target || !cmp) {
    return (
      <div className="compare compare--empty" data-testid="compare-view">
        <h2>Vertailu</h2>
        <p>
          Vertailua varten tarvitaan vähintään yksi tallennettu versio. Tallenna nykytila versioksi
          ja muokkaa prosessia, tai luo tavoitetila nykytilasta.
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => useUi.getState().setVersionsOpen(true)}
        >
          Versiot ja tavoitetila…
        </button>
      </div>
    )
  }

  const targetIsCurrent = target === project
  const label = (id: string) =>
    id === 'current' ? 'Nykyinen työversio' : (project.versions?.[id]?.name ?? '?')
  const kinds = ['added', 'removed', 'changed'] as const

  return (
    <div className="compare" data-testid="compare-view">
      <div className="compare__head">
        <h2>Vertailu</h2>
        <label>
          <span className="field__label">Lähtötila</span>
          <select
            aria-label="Lähtötila"
            value={effectiveBase}
            onChange={(e) => useUi.getState().setCompare(e.target.value, targetId)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field__label">Verrataan tilaan</span>
          <select
            aria-label="Verrattava tila"
            value={targetIsCurrent ? 'current' : targetId}
            onChange={(e) => useUi.getState().setCompare(effectiveBase, e.target.value)}
          >
            <option value="current">Nykyinen työversio</option>
            {versions
              .filter((v) => v.id !== effectiveBase)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </label>
        <div
          className="segmented segmented--compact"
          role="radiogroup"
          aria-label="Vertailun esitystapa"
        >
          {(['list', 'diagrams'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tab === t}
              className={tab === t ? 'is-on' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'list' ? 'Muutosluettelo' : 'Kaaviot rinnakkain'}
            </button>
          ))}
        </div>
      </div>

      <div className="acards">
        <div className="acard" data-testid="cmp-counts">
          <span className="acard__title">Muutokset</span>
          <strong className="acard__value">
            {cmp.identical
              ? 'Ei muutoksia'
              : `${cmp.counts.added + cmp.counts.removed + cmp.counts.changed} vaihetta`}
          </strong>
          <span className="acard__hint">
            {cmp.counts.added} lisätty · {cmp.counts.removed} poistettu · {cmp.counts.changed}{' '}
            muuttunut
          </span>
        </div>
        <div className="acard" data-testid="cmp-metrics">
          <span className="acard__title">Mittarit</span>
          <ul className="cmpmetrics">
            <li>
              Vaiheet: <Delta a={cmp.base.steps} b={cmp.target.steps} lowerIsBetter />
            </li>
            <li>
              Luovutukset: <Delta a={cmp.base.handoffs} b={cmp.target.handoffs} />
            </li>
            <li>
              Kierrokset: <Delta a={cmp.base.loops} b={cmp.target.loops} />
            </li>
            <li>
              Läpimeno:{' '}
              <Delta a={cmp.base.lead?.high} b={cmp.target.lead?.high} fmt={formatTotal} />
            </li>
            <li>
              Työaika: <Delta a={cmp.base.effort} b={cmp.target.effort} fmt={formatTotal} />
            </li>
            <li>
              Odotus: <Delta a={cmp.base.waiting} b={cmp.target.waiting} fmt={formatTotal} />
            </li>
          </ul>
        </div>
      </div>

      {tab === 'list' ? (
        <div className="compare__list">
          {cmp.identical && (
            <p className="muted">
              Tilat ovat samat: {label(effectiveBase)} ja{' '}
              {label(targetIsCurrent ? 'current' : targetId)}.
            </p>
          )}
          {kinds.map((k) => {
            const rows = cmp.nodes.filter((n) => n.kind === k)
            if (!rows.length) return null
            return (
              <section key={k} className="asection">
                <h3>
                  {KIND_LABEL[k]} ({rows.length})
                </h3>
                <ul className="changes">
                  {rows.map((c, i) => (
                    <NodeChangeRow key={`${k}-${i}`} c={c} canGo={targetIsCurrent} />
                  ))}
                </ul>
              </section>
            )
          })}
          {cmp.roleChanges.length > 0 && (
            <section className="asection" data-testid="role-changes">
              <h3>Roolimuutokset ({cmp.roleChanges.length})</h3>
              <ul className="changes">
                {cmp.roleChanges.map((c, i) => {
                  const f = c.fields.find((x) => x.field === 'role')!
                  return (
                    <li key={i}>
                      <strong>{c.label}</strong>: {f.before} → {f.after}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {cmp.edges.length > 0 && (
            <section className="asection">
              <h3>Yhteydet ({cmp.edges.length})</h3>
              <ul className="changes">
                {cmp.edges.map((e, i) => (
                  <li key={i} className={`change change--${e.kind}`}>
                    <span className="change__kind">{KIND_LABEL[e.kind]}</span> {e.fromLabel} →{' '}
                    {e.toLabel}
                    {e.kind === 'changed' && (
                      <span className="muted">
                        {' '}
                        ({e.before} → {e.after})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {cmp.processes.length > 0 && (
            <section className="asection">
              <h3>Prosessit</h3>
              <ul className="changes">
                {cmp.processes.map((p, i) => (
                  <li key={i} className={`change change--${p.kind}`}>
                    <span className="change__kind">{KIND_LABEL[p.kind]}</span> {p.name}
                    {p.before && <span className="muted"> (aiemmin {p.before})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="compare__diagrams" data-testid="compare-diagrams">
          <label className="check">
            <input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
            Avaa alaprosessit
          </label>
          <p className="field__hint">
            Vihreä = lisätty, punainen katkoviiva = poistettu, keltainen = muuttunut.
          </p>
          <div className="compare__panes">
            <DiagramPane
              title={label(effectiveBase)}
              project={base}
              marks={cmp.baseMarks}
              expand={expand}
            />
            <DiagramPane
              title={label(targetIsCurrent ? 'current' : targetId)}
              project={target}
              marks={cmp.targetMarks}
              expand={expand}
            />
          </div>
        </div>
      )}
    </div>
  )
}
