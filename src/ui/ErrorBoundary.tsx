import { Component, type ErrorInfo, type ReactNode } from 'react'
import { downloadText, safeFilename } from '../export/download'
import { projectToJson } from '../model/serialize'
import {
  getActiveProjectId,
  listBackups,
  listProjects,
  loadBackup,
  loadProject,
  saveProject,
  setActiveProjectId,
} from '../storage/db'

interface Props {
  fallback: (error: Error, reset: () => void) => ReactNode
  /** Kun avain vaihtuu, virhetila nollataan ja sisältö yritetään piirtää uudelleen. */
  resetKey?: string
  children?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    return error
      ? this.props.fallback(error, () => this.setState({ error: null }))
      : this.props.children
  }
}

/** Koko sovelluksen kaatuminen: työ on tallessa tietokannassa, ja sen saa ulos tästä. */
export function CrashScreen({ error }: { error: Error }) {
  const exportActive = async () => {
    const id = await getActiveProjectId()
    const project = id ? await loadProject(id) : undefined
    if (!project) return alert('Aktiivista projektia ei löytynyt tietokannasta.')
    downloadText(
      projectToJson(project),
      `${safeFilename(project.name)}.prosessikartta.json`,
      'application/json',
    )
  }
  const restoreLatest = async () => {
    const id = await getActiveProjectId()
    const list = await listBackups(id ?? undefined)
    const latest = list[0] ?? (await listBackups())[0]
    const project = latest && (await loadBackup(latest.id))
    if (!project) return alert('Varmuuskopioita ei löytynyt.')
    // Kopio otetaan käyttöön omana projektinaan, jotta mitään ei ylikirjoiteta.
    const ids = new Set((await listProjects()).map((p) => p.id))
    const copy = ids.has(project.id)
      ? { ...project, id: `${project.id}-palautettu`, name: `${project.name} (palautettu)` }
      : project
    await saveProject(copy)
    await setActiveProjectId(copy.id)
    location.reload()
  }
  return (
    <div className="crash" role="alert">
      <h1>Jokin meni pieleen</h1>
      <p>
        Sovellus kohtasi virheen. Työsi ei ole kadonnut: se on tallennettu selaimen tietokantaan.
        Lataa sivu uudelleen. Jos virhe toistuu, vie projekti tiedostoon tai palauta varmuuskopio.
      </p>
      <pre>{error.message}</pre>
      <div className="crash__actions">
        <button type="button" className="btn-primary" onClick={() => location.reload()}>
          Lataa sivu uudelleen
        </button>
        <button type="button" onClick={() => void exportActive()}>
          Vie projekti JSON-tiedostoon
        </button>
        <button type="button" onClick={() => void restoreLatest()}>
          Avaa viimeisin varmuuskopio
        </button>
      </div>
    </div>
  )
}

/** Yksittäisen näkymän kaatuminen: muu sovellus (esim. kumoa) toimii edelleen. */
export function ViewCrash({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="crash" role="alert">
      <h1>Tämä näkymä ei avautunut</h1>
      <p>
        Virhe rajoittui tähän näkymään. Voit yrittää uudelleen tai kumota viimeisimmän muutoksen
        (Ctrl+Z), jos se aiheutti virheen.
      </p>
      <pre>{error.message}</pre>
      <div className="crash__actions">
        <button type="button" className="btn-primary" onClick={reset}>
          Yritä uudelleen
        </button>
      </div>
    </div>
  )
}
