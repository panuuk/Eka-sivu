import { useRef } from 'react'
import { buildSampleProject } from '../model/sample'
import { processPath } from '../model/selectors'
import { usePwa } from '../pwa'
import { useAnalysis } from '../analysis/useAnalysis'
import { useStorage } from '../store/storage'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from './Icon'
import { Menu, type MenuItem } from './Menu'

function ReadinessPill() {
  const analysis = useAnalysis()
  const processId = useStore((s) => s.currentProcessId)
  const r = analysis.readiness(processId)
  if (r.nodes === 0) return null
  return (
    <button
      type="button"
      className="readiness-pill"
      title={`Valmiusaste ${r.percent} %. ${r.openQuestions} avointa kysymystä. Avaa kysymykset.`}
      aria-label={`Valmiusaste ${r.percent} prosenttia, ${r.openQuestions} avointa kysymystä`}
      onClick={() => useUi.getState().showRight('questions')}
      data-testid="readiness-pill"
    >
      <span className="readiness-pill__bar">
        <span style={{ width: `${r.percent}%` }} />
      </span>
      {r.percent} %{r.openQuestions > 0 && <b className="readiness-pill__q">{r.openQuestions}</b>}
    </button>
  )
}

function SaveStatus() {
  const status = useStore((s) => s.saveStatus)
  const link = useStorage((s) => s.fileLink)
  const pending = useStorage((s) => s.fileWritePending)
  const text = {
    idle: 'Tallennettu',
    saving: 'Tallennetaan…',
    saved: 'Tallennettu',
    error: 'Tallennus epäonnistui',
  }[status]
  const fileNote = link
    ? link.status === 'ok'
      ? pending
        ? ' · tiedosto…'
        : ' · tiedosto ✓'
      : ' · tiedosto ⚠'
    : ''
  return (
    <button
      type="button"
      className={`save-status save-status--${status}`}
      aria-label="Tallennus ja varmuuskopiot"
      title="Tallennus ja varmuuskopiot"
      onClick={() => useUi.getState().setStorageOpen(true)}
    >
      <span role="status" aria-live="polite">
        {`${text}${fileNote}`}
      </span>
    </button>
  )
}

export function TopBar() {
  const project = useStore((s) => s.project)!
  const projects = useStore((s) => s.projects)
  const currentProcessId = useStore((s) => s.currentProcessId)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const view = useUi((s) => s.view)
  const direction = useUi((s) => s.direction)
  const layoutMode = useUi((s) => s.layoutMode)
  const leftOpen = useUi((s) => s.leftOpen)
  const rightOpen = useUi((s) => s.rightOpen)
  const fileRef = useRef<HTMLInputElement>(null)
  const installPrompt = usePwa((s) => s.installPrompt)

  const path = processPath(project, currentProcessId)

  const projectItems: MenuItem[] = [
    ...projects.map((p) => ({
      label: p.name,
      checked: p.id === project.id,
      onSelect: () => void useStore.getState().openProject(p.id),
    })),
    {
      label: 'Uusi projekti…',
      separatorBefore: true,
      onSelect: async () => {
        const name = await useUi.getState().prompt({
          title: 'Uusi projekti',
          label: 'Projektin nimi',
          initial: 'Uusi projekti',
          confirmLabel: 'Luo',
        })
        if (name) await useStore.getState().createProject(name)
      },
    },
    {
      label: 'Uusi esimerkkiprojektista',
      onSelect: () => void useStore.getState().adoptProject(buildSampleProject()),
    },
    {
      label: 'Pikanäppäimet ja ohje',
      onSelect: () => useUi.getState().setHelpOpen(true),
    },
    {
      label: 'Nimeä projekti uudelleen…',
      onSelect: async () => {
        const name = await useUi.getState().prompt({
          title: 'Nimeä projekti',
          label: 'Projektin nimi',
          initial: project.name,
          confirmLabel: 'Tallenna',
        })
        if (name) useStore.getState().dispatch({ type: 'renameProject', name })
      },
    },
    ...(installPrompt
      ? [
          {
            label: 'Asenna sovellus…',
            onSelect: () => void usePwa.getState().install(),
          },
        ]
      : []),
    {
      label: 'Näkymät ja skenaariot…',
      separatorBefore: true,
      onSelect: () => useUi.getState().setSavedViewsOpen(true),
    },
    {
      label: 'Versiot ja tavoitetila…',
      onSelect: () => useUi.getState().setVersionsOpen(true),
    },
    {
      label: 'Tallennus ja varmuuskopiot…',
      onSelect: () => useUi.getState().setStorageOpen(true),
    },
    { label: 'Vie projekti (JSON)', onSelect: () => void useStorage.getState().exportJson() },
    { label: 'Tuo projekti (JSON)…', onSelect: () => fileRef.current?.click() },
    {
      label: 'Poista projekti…',
      danger: true,
      separatorBefore: true,
      onSelect: async () => {
        const ok = await useUi.getState().ask({
          title: `Poistetaanko “${project.name}”?`,
          message:
            'Projekti poistetaan tästä selaimesta pysyvästi. Vie se ensin JSON-tiedostoon, jos haluat säilyttää sen.',
          confirmLabel: 'Poista projekti',
          danger: true,
        })
        if (ok) await useStore.getState().deleteProject(project.id)
      },
    },
  ]

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn"
        aria-label="Näytä tai piilota prosessilista"
        aria-pressed={leftOpen}
        onClick={() => useUi.getState().toggleLeft()}
      >
        <Icon name="panelLeft" />
      </button>

      <Menu
        label="Projektit"
        triggerClassName="project-btn"
        trigger={
          <>
            <strong>{project.name}</strong>
            <Icon name="chevronDown" size={14} />
          </>
        }
        items={projectItems}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="import-input"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await useStore.getState().importProjectJson(await file.text())
        }}
      />

      <nav className="breadcrumb" aria-label="Sijainti">
        <ol>
          {path.map((p, i) => (
            <li key={p.id}>
              {i < path.length - 1 ? (
                <button
                  type="button"
                  className="linklike"
                  onClick={() => useStore.getState().setCurrentProcess(p.id)}
                >
                  {p.name}
                </button>
              ) : (
                <span aria-current="page">{p.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <ReadinessPill />
      <div className="topbar__spacer" />
      <SaveStatus />

      <div className="btn-group">
        <button
          type="button"
          className="icon-btn"
          aria-label="Kumoa"
          title="Kumoa (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => useStore.getState().undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Tee uudelleen"
          title="Tee uudelleen (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={() => useStore.getState().redo()}
        >
          <Icon name="redo" />
        </button>
      </div>

      <div className="segmented segmented--compact" role="radiogroup" aria-label="Näkymä">
        <button
          type="button"
          role="radio"
          aria-checked={view === 'canvas'}
          className={view === 'canvas' ? 'is-on' : ''}
          onClick={() => useUi.getState().setView('canvas')}
        >
          <Icon name="graph" size={16} /> <span className="hide-sm">Kaavio</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === 'list'}
          className={view === 'list' ? 'is-on' : ''}
          onClick={() => useUi.getState().setView('list')}
        >
          <Icon name="list" size={16} /> <span className="hide-sm">Lista</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === 'sources'}
          className={view === 'sources' ? 'is-on' : ''}
          onClick={() => useUi.getState().setView('sources')}
        >
          <Icon name="file" size={16} /> <span className="hide-sm">Lähteet</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === 'analysis'}
          className={view === 'analysis' ? 'is-on' : ''}
          onClick={() => useUi.getState().setView('analysis')}
        >
          <Icon name="graph" size={16} /> <span className="hide-sm">Analyysi</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === 'compare'}
          className={view === 'compare' ? 'is-on' : ''}
          onClick={() => useUi.getState().setView('compare')}
        >
          <Icon name="merge" size={16} /> <span className="hide-sm">Vertailu</span>
        </button>
      </div>

      {view === 'canvas' && layoutMode !== 'lanes' && (
        <button
          type="button"
          className="icon-btn"
          aria-label={direction === 'DOWN' ? 'Vaihda vaakasuuntaan' : 'Vaihda pystysuuntaan'}
          title={direction === 'DOWN' ? 'Asettelu: ylhäältä alas' : 'Asettelu: vasemmalta oikealle'}
          onClick={() => useUi.getState().setDirection(direction === 'DOWN' ? 'RIGHT' : 'DOWN')}
        >
          <Icon name="swap" />
        </button>
      )}

      <button
        type="button"
        className="btn-quick"
        aria-label="Pikasyöte"
        title="Lisää tai vie prosessi tekstinä (Ctrl+K)"
        onClick={() => useUi.getState().openQuick('add')}
      >
        <Icon name="edit" size={16} /> <span className="hide-sm">Pikasyöte</span>
      </button>
      <button
        type="button"
        className="btn-quick btn-quick--plain"
        aria-label="Esitä"
        title="Esitä muille: siisti koko ruudun näkymä ja läpikäynti"
        onClick={() => useUi.getState().setPresenting(true)}
      >
        <Icon name="play" size={16} /> <span className="hide-sm">Esitä</span>
      </button>
      <button
        type="button"
        className="btn-quick btn-quick--plain"
        aria-label="Vie ja jaa"
        title="Vie kuvana, dokumenttina tai tiedostona"
        onClick={() => useUi.getState().setExportOpen(true)}
      >
        <Icon name="download" size={16} /> <span className="hide-sm">Vie</span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Roolit, järjestelmät ja tuotokset"
        title="Roolit, järjestelmät ja tuotokset"
        onClick={() => useUi.getState().setEntityManagerOpen(true)}
      >
        <Icon name="user" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Näytä tai piilota ominaisuudet"
        aria-pressed={rightOpen}
        onClick={() => useUi.getState().toggleRight()}
      >
        <Icon name="panelRight" />
      </button>
    </header>
  )
}
