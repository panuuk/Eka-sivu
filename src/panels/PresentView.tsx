import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildGraph, currentRequest, svgOptions } from '../export/run'
import { cropFor, pathOption } from '../export/views'
import { scenarioPath } from '../model/scenario'
import type { RenderGraph } from '../export/graph'
import { renderSvg } from '../export/svg'
import { themeColors } from '../export/theme'
import { walkSteps } from '../export/walk'
import { processPath } from '../model/selectors'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { PresentSettings } from './PresentSettings'

const MARGIN = 32
const CONF = { guess: 'Arvaus', likely: 'Todennäköinen', confirmed: 'Vahvistettu' } as const

/**
 * Esitystila: siisti koko ruudun näkymä muille näytettäväksi. Piilottaa kysymykset, muistiinpanot ja
 * (oletuksena) epävarmuusmerkinnät. Läpikäynti etenee vaihe vaiheelta ja korostaa kulkureitin.
 */
export function PresentView() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const theme = useUi((s) => s.theme)
  const options = useUi((s) => s.present)
  const direction = useUi((s) => s.direction)
  const presentViewId = useUi((s) => s.presentViewId)
  const presentScenarioId = useUi((s) => s.presentScenarioId)
  const colors = themeColors(theme)

  const [graph, setGraph] = useState<RenderGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [walking, setWalking] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [focusId, setFocusId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const fitFor = useCallback((g: RenderGraph, crop?: { width: number; height: number }) => {
    const el = stageRef.current
    if (!el || g.width === 0) return 1
    const w = (crop?.width ?? g.width) + MARGIN * 2
    const h = (crop?.height ?? g.height) + MARGIN * 2
    return Math.max(0.1, Math.min((el.clientWidth - 24) / w, (el.clientHeight - 24) / h, 1.5))
  }, [])

  const view = useMemo(
    () => project.views?.find((v) => v.id === presentViewId && v.processId === processId),
    [project.views, presentViewId, processId],
  )
  const scenario = presentScenarioId ? project.scenarios?.[presentScenarioId] : undefined
  const scenarioHere = scenario && scenario.processId === processId ? scenario : undefined
  const pathInfo = useMemo(
    () =>
      scenarioHere
        ? scenarioPath(project, scenarioHere.processId, scenarioHere.choices)
        : undefined,
    [project, scenarioHere],
  )
  const crop = useMemo(
    () => (graph && view ? cropFor(graph, view.focusNodeIds) : undefined),
    [graph, view],
  )

  // Asettelu lasketaan uudelleen, kun prosessi tai sisältöasetukset muuttuvat
  useEffect(() => {
    let cancelled = false
    buildGraph(currentRequest(project, processId))
      .then((g) => {
        if (cancelled) return
        setGraph(g)
        setZoom(fitFor(g, view ? cropFor(g, view.focusNodeIds) : undefined))
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // view vaikuttaa vain rajaukseen, joka lasketaan graafista
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, processId, options.expand, options.onlyConfirmed, options.heat, direction, fitFor])

  const steps = useMemo(() => {
    if (!graph) return []
    const visible = new Set(graph.nodes.map((n) => n.id))
    if (pathInfo) {
      // Skenaarion läpikäynti: vain polun vaiheet kulkujärjestyksessä
      const ids = pathInfo.nodeIds.filter((id) => visible.has(id))
      return ids
        .map((id, i) => ({
          node: project.nodes[id],
          next: ids[i + 1]
            ? [
                {
                  id: ids[i + 1],
                  label: Object.values(project.edges).find(
                    (e) => e.from === id && e.to === ids[i + 1],
                  )?.label,
                },
              ]
            : [],
        }))
        .filter((st) => st.node)
    }
    return walkSteps(project, processId, visible, options.expand)
  }, [graph, project, processId, options.expand, pathInfo])
  const idx = Math.min(stepIdx, Math.max(steps.length - 1, 0))
  const currentId = walking ? steps[idx]?.node.id : (focusId ?? undefined)
  const visited = useMemo(
    () => (walking ? new Set(steps.slice(0, idx).map((s) => s.node.id)) : undefined),
    [walking, steps, idx],
  )

  // Pyyntö luetaan storesta jokaisella piirrolla, ja sen osat ovat muistin riippuvuuksia, jotta
  // asetusten (teema, lämpökartta, muutosten korostus) vaihto päivittää kuvan.
  const req = currentRequest(project, processId)
  const { options: reqOptions, theme: reqTheme, comparison: reqComparison } = req
  const svg = useMemo(() => {
    if (!graph) return ''
    const name = project.processes[processId]?.name ?? 'Prosessi'
    return renderSvg(graph, {
      ...svgOptions(
        {
          project,
          processId,
          theme: reqTheme,
          options: reqOptions,
          direction,
          comparison: reqComparison,
        },
        name,
      ),
      highlight: currentId ? { current: currentId, visited } : undefined,
      path: walking ? undefined : pathOption(pathInfo),
      crop,
    })
  }, [
    graph,
    project,
    processId,
    currentId,
    visited,
    reqOptions,
    reqTheme,
    reqComparison,
    direction,
    pathInfo,
    crop,
    walking,
  ])

  // Keskitä kuva korostettuun vaiheeseen
  useEffect(() => {
    const el = stageRef.current
    if (!el || !graph || !currentId) return
    const n = graph.nodes.find((x) => x.id === currentId)
    if (!n) return
    const cx = (n.x + n.w / 2 + MARGIN - (crop?.x ?? 0)) * zoom
    const cy = (n.y + n.h / 2 + MARGIN - (crop?.y ?? 0)) * zoom
    el.scrollTo({
      left: cx - el.clientWidth / 2 + (walking ? -150 : 0),
      top: cy - el.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [currentId, graph, zoom, walking, crop])

  const go = useCallback(
    (delta: number) => {
      setWalking(true)
      setStepIdx((i) =>
        Math.max(
          0,
          Math.min(steps.length - 1, (walking ? Math.min(i, steps.length - 1) : -1) + delta),
        ),
      )
    },
    [steps.length, walking],
  )

  const close = useCallback(() => {
    useUi.getState().setPresenting(false)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.closest('dialog'))) return
      if (e.key === 'Escape') {
        if (walking || focusId) {
          setWalking(false)
          setFocusId(null)
        } else close()
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Home' && walking) setStepIdx(0)
      else if (e.key === 'End' && walking) setStepIdx(steps.length - 1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(3, z * 1.2))
      else if (e.key === '-') setZoom((z) => Math.max(0.1, z / 1.2))
      else if (e.key === '0' && graph) setZoom(fitFor(graph, crop))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [walking, focusId, go, close, steps.length, graph, fitFor, crop])

  /** Ottaa tallennetun näkymän käyttöön: prosessi, asetukset, skenaario ja rajaus. */
  const selectView = (id: string) => {
    const v = project.views?.find((x) => x.id === id)
    setWalking(false)
    setFocusId(null)
    const ui = useUi.getState()
    if (!v) {
      ui.setPresentView(null)
      return
    }
    ui.setPresentView(v.id)
    ui.setPresentScenario(v.scenarioId ?? null)
    ui.setPresentOptions({
      expand: v.expand,
      onlyConfirmed: v.onlyConfirmed,
      showMetrics: v.showMetrics,
      heat: v.heat,
      changes: v.changes,
    })
    if (project.processes[v.processId]) useStore.getState().setCurrentProcess(v.processId)
  }

  const path = processPath(project, processId)
  const focusNode = currentId ? project.nodes[currentId] : undefined
  const walkStep = walking ? steps[idx] : undefined
  const nextOptions =
    walkStep?.next ??
    (focusNode && graph
      ? graph.edges
          .filter((e) => e.from === focusNode.id)
          .map((e) => ({ id: e.to, label: e.label }))
      : [])
  const entityNames = (ids: string[]) => ids.map((i) => project.entities[i]?.name).filter(Boolean)

  const jumpTo = (id: string) => {
    const i = steps.findIndex((s) => s.node.id === id)
    if (walking && i >= 0) setStepIdx(i)
    else setFocusId(id)
  }

  const svgW = graph ? (crop?.width ?? graph.width) + MARGIN * 2 : 0
  const svgH = graph ? (crop?.height ?? graph.height) + MARGIN * 2 : 0

  return (
    <div
      className="present"
      role="region"
      aria-label="Esitys"
      style={{
        ['--p-bg' as string]: colors.bg,
        ['--p-text' as string]: colors.text,
        ['--p-muted' as string]: colors.muted,
        ['--p-surface' as string]: colors.surface,
        ['--p-border' as string]: colors.border,
        ['--p-accent' as string]: colors.accent,
      }}
      data-testid="present"
    >
      <header className="present__bar">
        <button type="button" className="present__btn" onClick={close} aria-label="Sulje esitys">
          <Icon name="x" size={16} /> Sulje
        </button>
        <nav className="present__crumbs" aria-label="Sijainti">
          {path.map((pr, i) => (
            <span key={pr.id}>
              {i < path.length - 1 ? (
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setWalking(false)
                    setFocusId(null)
                    useStore.getState().setCurrentProcess(pr.id)
                  }}
                >
                  {pr.name}
                </button>
              ) : (
                <strong aria-current="page">{pr.name}</strong>
              )}
              {i < path.length - 1 && ' › '}
            </span>
          ))}
        </nav>
        <span className="present__spacer" />
        {(project.views?.length ?? 0) > 0 && (
          <label className="present__select">
            Näkymä
            <select
              aria-label="Näkymä"
              value={view?.id ?? ''}
              onChange={(e) => selectView(e.target.value)}
            >
              <option value="">Ei valittu</option>
              {project.views!.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {Object.keys(project.scenarios ?? {}).length > 0 && (
          <label className="present__select">
            Skenaario
            <select
              aria-label="Skenaario"
              value={scenarioHere?.id ?? ''}
              onChange={(e) => {
                setWalking(false)
                setFocusId(null)
                useUi.getState().setPresentScenario(e.target.value || null)
              }}
            >
              <option value="">Ei</option>
              {Object.values(project.scenarios ?? {})
                .filter((sc) => sc.processId === processId)
                .map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={`present__btn ${walking ? 'is-on' : ''}`}
          onClick={() => (walking ? setWalking(false) : go(1))}
          disabled={steps.length === 0}
          data-testid="walk-toggle"
        >
          <Icon name="play" size={16} /> {walking ? 'Lopeta läpikäynti' : 'Läpikäynti'}
        </button>
        <details className="present__settings">
          <summary className="present__btn">Asetukset</summary>
          <div className="present__popover">
            <PresentSettings idPrefix="present" />
          </div>
        </details>
        <div className="present__zoom" role="group" aria-label="Zoomaus">
          <button
            type="button"
            className="present__btn"
            onClick={() => setZoom((z) => Math.max(0.1, z / 1.2))}
            aria-label="Loitonna"
          >
            −
          </button>
          <button
            type="button"
            className="present__btn"
            onClick={() => graph && setZoom(fitFor(graph, crop))}
          >
            Sovita
          </button>
          <button
            type="button"
            className="present__btn"
            onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
            aria-label="Lähennä"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="present__btn"
          onClick={() => useUi.getState().setExportOpen(true)}
        >
          <Icon name="download" size={16} /> Vie
        </button>
        <button
          type="button"
          className="present__btn"
          onClick={() => useUi.getState().setSavedViewsOpen(true)}
        >
          Näkymät…
        </button>
      </header>

      <div
        className="present__stage"
        ref={stageRef}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-id]')) return
          const el = stageRef.current!
          pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
          el.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const p = pan.current
          const el = stageRef.current
          if (!p || !el) return
          el.scrollLeft = p.left - (e.clientX - p.x)
          el.scrollTop = p.top - (e.clientY - p.y)
        }}
        onPointerUp={() => (pan.current = null)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setZoom((z) => Math.max(0.1, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))
          }
        }}
      >
        {error && <p className="present__msg">{error}</p>}
        {graph && graph.nodes.length === 0 && (
          <p className="present__msg">Tässä prosessissa ei ole vielä näytettävää.</p>
        )}
        {graph && graph.nodes.length > 0 && (
          <div
            className="present__svg"
            style={{ width: svgW * zoom, height: svgH * zoom }}
            data-testid="present-svg"
            // SVG on oma tuotoksemme: kaikki käyttäjän tekstit on escapettu renderSvg:ssä.
            dangerouslySetInnerHTML={{ __html: svg }}
            onClick={(e) => {
              const g = (e.target as Element).closest('[data-id]')
              const id = g?.getAttribute('data-id')
              if (!id) {
                if (!walking) setFocusId(null)
                return
              }
              const n = graph.nodes.find((x) => x.id === id)
              const child = project.nodes[id]?.childProcessId
              if (n && n.kind === 'subprocess' && n.hasChild && !n.group && child) {
                // Alaprosessiin porautuminen
                setWalking(false)
                setFocusId(null)
                useStore.getState().setCurrentProcess(child)
                return
              }
              jumpTo(id)
            }}
          />
        )}
      </div>

      {focusNode && (
        <aside className="present__card" aria-label="Vaiheen tiedot" data-testid="present-card">
          {walking && (
            <p className="present__progress">
              Askel {idx + 1} / {steps.length}
            </p>
          )}
          <h2>{focusNode.label}</h2>
          {focusNode.roleId && project.entities[focusNode.roleId] && (
            <p>
              <span className="present__k">Vastuu</span> {project.entities[focusNode.roleId].name}
            </p>
          )}
          {focusNode.systemIds.length > 0 && (
            <p>
              <span className="present__k">Järjestelmät</span>{' '}
              {entityNames(focusNode.systemIds).join(', ')}
            </p>
          )}
          {focusNode.inputIds.length > 0 && (
            <p>
              <span className="present__k">Syötteet</span>{' '}
              {entityNames(focusNode.inputIds).join(', ')}
            </p>
          )}
          {focusNode.outputIds.length > 0 && (
            <p>
              <span className="present__k">Tuotokset</span>{' '}
              {entityNames(focusNode.outputIds).join(', ')}
            </p>
          )}
          {focusNode.description && <p className="present__desc">{focusNode.description}</p>}
          {options.showUncertainty && (
            <p>
              <span className="present__k">Varmuus</span> {CONF[focusNode.confidence]}
            </p>
          )}
          {nextOptions.length > 0 && (
            <div className="present__next">
              <span className="present__k">Seuraavaksi</span>
              {nextOptions.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="present__chip"
                  onClick={() => jumpTo(n.id)}
                >
                  {n.label ? <b>{n.label}: </b> : null}
                  {project.nodes[n.id]?.label}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}

      {walking && (
        <div className="present__walk" role="group" aria-label="Läpikäynnin ohjaus">
          <button type="button" className="present__btn" onClick={() => go(-1)} disabled={idx <= 0}>
            ◀ Edellinen
          </button>
          <span aria-live="polite">
            {idx + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="present__btn"
            onClick={() => go(1)}
            disabled={idx >= steps.length - 1}
            data-testid="walk-next"
          >
            Seuraava ▶
          </button>
        </div>
      )}
      <p className="present__hint">←/→ läpikäynti · +/− zoom · 0 sovita · Esc sulje</p>
    </div>
  )
}
