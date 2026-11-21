import { usePwa } from '../pwa'
import { Icon } from './Icon'

/** Ilmoitus uudesta versiosta ja offline-valmiudesta. */
export function UpdateBar() {
  const updateReady = usePwa((s) => s.updateReady)
  const offlineReady = usePwa((s) => s.offlineReady)

  if (updateReady) {
    return (
      <div className="notice" role="status" data-testid="update-bar">
        <Icon name="download" />
        <span>Uusi versio on valmis. Työsi tallennetaan ennen päivitystä.</span>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void usePwa.getState().applyUpdate()}
        >
          Päivitä nyt
        </button>
        <button type="button" onClick={() => usePwa.getState().dismissUpdate()}>
          Myöhemmin
        </button>
      </div>
    )
  }
  if (offlineReady) {
    return (
      <div className="notice" role="status" data-testid="offline-ready">
        <Icon name="check" />
        <span>Sovellus on valmis käytettäväksi myös ilman verkkoyhteyttä.</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Sulje"
          onClick={() => usePwa.getState().dismissOffline()}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    )
  }
  return null
}
