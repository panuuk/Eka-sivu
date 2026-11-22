import { useMemo, useState } from 'react'
import { metricsOf, summarizeScope } from '../analysis/metrics'
import { formatRange, formatTotal } from '../model/duration'
import { nextRaciState, opsSetRaci, raciStateOf, type RaciState } from '../model/commands'
import { flowOrder } from '../model/flow'
import { descendantProcessIds } from '../model/operations'
import { entitiesOfKind, processTree } from '../model/selectors'
import type { Project } from '../model/types'
import { goToNode } from '../store/actions'
import { useStore } from '../store/store'
import { Icon, type IconName } from '../ui/Icon'

type Scope = 'process' | 'project'

const WORK = new Set(['step', 'decision', 'subprocess'])

function Card({
  title,
  value,
  hint,
  testid,
  icon,
  tone,
}: {
  title: string
  value: string
  hint?: string
  testid?: string
  icon?: IconName
  tone?: 'ok' | 'warn' | 'violet' | 'danger'
}) {
  return (
    <div className={`acard${tone ? ` acard--${tone}` : ''}`} data-testid={testid}>
      {icon && (
        <span className="acard__icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="acard__title">{title}</span>
      <strong className="acard__value">{value}</strong>
      {hint && <span className="acard__hint">{hint}</span>}
    </div>
  )
}

const roleName = (p: Project, id?: string) => (id ? (p.entities[id]?.name ?? '?') : 'Ei roolia')

/** RACI-matriisi: vaiheet riveillä, roolit sarakkeilla. Solua napsauttamalla tila kiertää R, A, C, I ja tyhjä. */
function RaciMatrix({ project, processIds }: { project: Project; processIds: string[] }) {
  const dispatch = useStore((s) => s.dispatch)
  const groups = useMemo(
    () =>
      processIds.map((pid) => ({
        process: project.processes[pid],
        rows: flowOrder(project, pid)
          .map((r) => r.node)
          .filter((n) => WORK.has(n.kind) && !n.childProcessId),
      })),
    [project, processIds],
  )
  const roleIds = useMemo(() => {
    const used = new Set<string>()
    for (const g of groups)
      for (const n of g.rows) {
        if (n.roleId) used.add(n.roleId)
        for (const id of [
          ...(n.raci?.accountableIds ?? []),
          ...(n.raci?.consultedIds ?? []),
          ...(n.raci?.informedIds ?? []),
        ])
          used.add(id)
      }
    return entitiesOfKind(project, 'role')
      .filter((r) => used.has(r.id))
      .map((r) => r.id)
  }, [groups, project])

  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (total === 0) return <p className="muted">Ei vaiheita.</p>
  if (roleIds.length === 0)
    return <p className="muted">Lisää vaiheisiin rooleja, niin matriisi täyttyy.</p>

  const anyAccountable = groups.some((g) =>
    g.rows.some((n) => (n.raci?.accountableIds?.length ?? 0) > 0),
  )

  return (
    <div className="matrix-wrap">
      <table className="matrix" data-testid="raci-matrix">
        <caption className="sr-only">RACI-matriisi</caption>
        <thead>
          <tr>
            <th scope="col">Vaihe</th>
            {roleIds.map((id) => (
              <th key={id} scope="col" title={roleName(project, id)}>
                <span>{roleName(project, id)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows
              key={g.process.id}
              project={project}
              name={groups.length > 1 ? g.process.name : undefined}
              rows={g.rows}
              roleIds={roleIds}
              colSpan={roleIds.length + 1}
              anyAccountable={anyAccountable}
              onCycle={(nodeId, roleId, state) =>
                dispatch(
                  opsSetRaci(
                    project,
                    nodeId,
                    roleId,
                    nextRaciState(
                      state,
                      !!project.nodes[nodeId]?.roleId && project.nodes[nodeId].roleId !== roleId,
                    ),
                  ),
                )
              }
            />
          ))}
        </tbody>
      </table>
      <p className="field__hint">
        R = tekee, A = vastaa lopputuloksesta, C = konsultoidaan, I = informoidaan. Napsauta solua
        vaihtaaksesi. Suorittajan (R) vaihdat vaiheen ominaisuuksista.
        {anyAccountable && ' Varoituskolmio (⚠) merkitsee vaihetta, jolta puuttuu A.'}
      </p>
    </div>
  )
}

function GroupRows({
  project,
  name,
  rows,
  roleIds,
  colSpan,
  anyAccountable,
  onCycle,
}: {
  project: Project
  name?: string
  rows: ReturnType<typeof flowOrder>[number]['node'][]
  roleIds: string[]
  colSpan: number
  anyAccountable: boolean
  onCycle: (nodeId: string, roleId: string, state: RaciState) => void
}) {
  return (
    <>
      {name && (
        <tr className="matrix__group">
          <th colSpan={colSpan} scope="colgroup">
            {name}
          </th>
        </tr>
      )}
      {rows.map((n) => {
        const noA = anyAccountable && !(n.raci?.accountableIds?.length ?? 0)
        return (
          <tr key={n.id}>
            <th scope="row">
              <button type="button" className="linklike" onClick={() => goToNode(n.id)}>
                {n.label || 'Nimetön'}
              </button>
              {noA && (
                <span title="Vaiheelta puuttuu A (vastuullinen)" aria-label="A puuttuu">
                  {' '}
                  ⚠
                </span>
              )}
            </th>
            {roleIds.map((roleId) => {
              const state = raciStateOf(project, n.id, roleId)
              return (
                <td key={roleId}>
                  <button
                    type="button"
                    className={`cell cell--${state || 'none'}`}
                    aria-label={`${n.label}, ${roleName(project, roleId)}: ${state || 'ei merkintää'}`}
                    onClick={() => onCycle(n.id, roleId, state)}
                  >
                    {state || '·'}
                  </button>
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function SystemMatrix({ project, processIds }: { project: Project; processIds: string[] }) {
  const ids = new Set(processIds)
  const nodes = Object.values(project.nodes).filter(
    (n) => ids.has(n.processId) && WORK.has(n.kind) && !n.childProcessId,
  )
  const roles = [...new Set(nodes.map((n) => n.roleId))]
  const systems = entitiesOfKind(project, 'system').filter((s) =>
    nodes.some((n) => n.systemIds.includes(s.id)),
  )
  if (systems.length === 0 || roles.length === 0)
    return <p className="muted">Lisää vaiheisiin järjestelmiä, niin matriisi täyttyy.</p>
  const count = (roleId: string | undefined, systemId: string) =>
    nodes.filter((n) => n.roleId === roleId && n.systemIds.includes(systemId)).length
  const max = Math.max(1, ...roles.flatMap((r) => systems.map((s) => count(r, s.id))))
  return (
    <div className="matrix-wrap">
      <table className="matrix" data-testid="system-matrix">
        <caption className="sr-only">Rooli ja järjestelmä -matriisi</caption>
        <thead>
          <tr>
            <th scope="col">Rooli</th>
            {systems.map((s) => (
              <th key={s.id} scope="col">
                <span>{s.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r ?? 'none'}>
              <th scope="row">{roleName(project, r)}</th>
              {systems.map((s) => {
                const c = count(r, s.id)
                return (
                  <td key={s.id}>
                    <span
                      className="cell cell--count"
                      style={{ opacity: c ? 0.35 + (0.65 * c) / max : 0.25 }}
                    >
                      {c || '·'}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Analyysinäkymä: läpimenoaika, luovutukset, kierrokset, kuormitus, matriisit ja kipupisteet. */
export function AnalysisView() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const [scope, setScope] = useState<Scope>('process')

  const metrics = useMemo(() => metricsOf(project), [project])
  const processIds = useMemo(
    () =>
      scope === 'project'
        ? processTree(project).map((x) => x.process.id)
        : descendantProcessIds(project, processId),
    [scope, project, processId],
  )
  const summary = useMemo(
    () => summarizeScope(project, metrics.perProcess, processIds),
    [project, metrics, processIds],
  )
  const lead = metrics.perProcess.get(processId)?.lead
  const here = metrics.perProcess.get(processId)
  const totalTime = summary.effort + summary.waiting
  const maxLoad = Math.max(1, ...summary.roleLoad.map((r) => r.effort + r.waiting))
  const estimated = processIds.reduce(
    (n, id) => n + (metrics.perProcess.get(id)?.estimatedSteps ?? 0),
    0,
  )
  const workSteps = processIds.reduce(
    (n, id) => n + (metrics.perProcess.get(id)?.workSteps ?? 0),
    0,
  )

  return (
    <div className="analysis" data-testid="analysis-view">
      <div className="analysis__head">
        <h2>Analyysi: {scope === 'process' ? project.processes[processId]?.name : project.name}</h2>
        <div className="segmented segmented--compact" role="radiogroup" aria-label="Laajuus">
          {(['process', 'project'] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              className={scope === s ? 'is-on' : ''}
              onClick={() => setScope(s)}
            >
              {s === 'process' ? 'Tämä prosessi' : 'Koko projekti'}
            </button>
          ))}
        </div>
      </div>

      <div className="acards">
        <Card
          testid="card-lead"
          icon="clock"
          title="Läpimenoaika (tämä prosessi)"
          value={
            lead?.typicalHigh !== undefined
              ? lead.typicalLow !== undefined && lead.typicalLow !== lead.typicalHigh
                ? `${formatTotal(lead.typicalLow)}–${formatTotal(lead.typicalHigh)}`
                : formatTotal(lead.typicalHigh)
              : '–'
          }
          hint={
            lead?.typicalHigh !== undefined
              ? `nopeimmillaan ${formatTotal(lead.best ?? 0)}, hitaimmillaan ${formatTotal(lead.worst ?? 0)}. Arvio kattaa ${lead.coveredSteps}/${lead.pathSteps} vaihetta pisimmällä polulla.`
              : 'Lisää vaiheille työaika tai odotusaika (esim. =2 pv).'
          }
        />
        <Card
          testid="card-handoffs"
          icon="swap"
          tone="violet"
          title="Luovutukset"
          value={String(summary.handoffCount)}
          hint="Siirtymät roolilta toiselle"
        />
        <Card
          testid="card-loops"
          icon="loop"
          tone="danger"
          title="Uudelleenkierrokset"
          value={String(summary.loopCount)}
          hint="Paluuyhteydet aiempaan vaiheeseen"
        />
        <Card
          testid="card-wait"
          icon="hourglass"
          tone="warn"
          title="Odotuksen osuus"
          value={totalTime > 0 ? `${Math.round((summary.waiting / totalTime) * 100)} %` : '–'}
          hint={
            totalTime > 0
              ? `Työ ${formatTotal(summary.effort)}, odotus ${formatTotal(summary.waiting)}`
              : `${estimated}/${workSteps} vaiheella on kestoarvio`
          }
        />
      </div>

      {here &&
        lead &&
        lead.criticalPath.length > 0 &&
        lead.typicalHigh !== undefined &&
        scope === 'process' && (
          <section className="asection">
            <h3>Kriittinen polku</h3>
            <ol className="critical" data-testid="critical-path">
              {lead.criticalPath
                .map((id) => project.nodes[id])
                .filter((n) => n && WORK.has(n.kind))
                .map((n) => (
                  <li key={n.id}>
                    <button type="button" className="linklike" onClick={() => goToNode(n.id)}>
                      {n.label}
                    </button>
                    <span className="muted">
                      {' '}
                      {[
                        n.duration ? formatRange(n.duration) : '',
                        n.waiting ? `⏳ ${formatRange(n.waiting)}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'ei arviota'}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        )}

      <section className="asection">
        <h3>Luovutukset roolien välillä</h3>
        {summary.rolePairs.length === 0 ? (
          <p className="muted">
            Ei luovutuksia. Luovutus syntyy, kun peräkkäisillä vaiheilla on eri rooli.
          </p>
        ) : (
          <table className="atable" data-testid="handoff-table">
            <thead>
              <tr>
                <th scope="col">Mistä</th>
                <th scope="col">Minne</th>
                <th scope="col">Kertaa</th>
                <th scope="col">Odotus yht.</th>
              </tr>
            </thead>
            <tbody>
              {summary.rolePairs.map((r) => (
                <tr key={`${r.fromRoleId}>${r.toRoleId}`}>
                  <td>{roleName(project, r.fromRoleId)}</td>
                  <td>{roleName(project, r.toRoleId)}</td>
                  <td>{r.count}</td>
                  <td>{r.waiting ? formatTotal(r.waiting) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="asection">
        <h3>Uudelleenkierrokset</h3>
        {summary.loops.length === 0 ? (
          <p className="muted">Ei paluuyhteyksiä.</p>
        ) : (
          <ul className="loops" data-testid="loop-list">
            {summary.loops.map((l) => (
              <li key={`${l.fromId}>${l.toId}`}>
                <button type="button" className="linklike" onClick={() => goToNode(l.fromId)}>
                  {project.nodes[l.fromId]?.label}
                </button>{' '}
                <Icon name="enter" size={12} />{' '}
                <button type="button" className="linklike" onClick={() => goToNode(l.toId)}>
                  {project.nodes[l.toId]?.label}
                </button>
                <span className="muted">
                  {' '}
                  · {l.nodeIds.length} vaihetta
                  {l.extraMinutes !== undefined
                    ? ` · +${formatTotal(l.extraMinutes)} per kierros`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="asection">
        <h3>Roolien kuormitus</h3>
        {summary.roleLoad.length === 0 ? (
          <p className="muted">Ei vaiheita.</p>
        ) : (
          <ul className="loads" data-testid="role-load">
            {summary.roleLoad.map((r) => (
              <li key={r.roleId ?? 'none'}>
                <span className="loads__name">{roleName(project, r.roleId)}</span>
                <span className="loads__bar" aria-hidden="true">
                  <span
                    className="loads__work"
                    style={{ width: `${(r.effort / maxLoad) * 100}%` }}
                  />
                  <span
                    className="loads__wait"
                    style={{ width: `${(r.waiting / maxLoad) * 100}%` }}
                  />
                </span>
                <span className="loads__text">
                  {r.steps} vaihetta
                  {r.effort + r.waiting > 0
                    ? ` · työ ${formatTotal(r.effort)}${r.waiting ? `, odotus ${formatTotal(r.waiting)}` : ''}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="asection">
        <h3>RACI-matriisi</h3>
        <RaciMatrix project={project} processIds={processIds} />
      </section>

      <section className="asection">
        <h3>Rooli × järjestelmä</h3>
        <SystemMatrix project={project} processIds={processIds} />
      </section>

      <section className="asection">
        <h3>Kipupisteet ja parannusideat</h3>
        {summary.painPoints.length === 0 ? (
          <p className="muted">
            Ei kipupisteitä. Lisää ne vaiheen Tietotyö-osiossa tai merkinnällä !.
          </p>
        ) : (
          <ul className="pains" data-testid="pain-list">
            {summary.painPoints.map((pp) => (
              <li key={pp.id} className={`pain pain--${pp.severity}`}>
                <div>
                  <strong>{pp.text}</strong>
                  {pp.idea && <div className="muted">Idea: {pp.idea}</div>}
                </div>
                <button type="button" className="linklike" onClick={() => goToNode(pp.nodeId)}>
                  {project.nodes[pp.nodeId]?.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
