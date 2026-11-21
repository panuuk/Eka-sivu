import { useState } from 'react'
import { backupReminderDue } from '../storage/backupPolicy'
import { useStorage } from '../store/storage'
import { useStore } from '../store/store'
import { useTabs } from '../store/tabs'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

const SNOOZE_KEY = 'prosessikartta.reminderSnooze'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

function readSnooze(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

/**
 * Muistutus tiedostovarmuuskopiosta sekä tiedostoyhteyden tilasta: lupa puuttuu tai kirjoitus
 * epäonnistui. Näitä ei saa jättää huomaamatta, koska muuten työ voi näyttää turvatulta, vaikka
 * tiedosto ei päivity.
 */
/** Varoitus, kun sovellus on auki useassa välilehdessä. */
export function TabsBar() {
  const other = useTabs((s) => s.otherTabOpen)
  if (!other) return null
  return (
    <div className="notice notice--warn" role="status" data-testid="other-tab-warning">
      <Icon name="warn" />
      <span>
        Sovellus on auki myös toisessa välilehdessä. Muokkaa projektia vain yhdessä välilehdessä,
        muuten välilehtien muutokset voivat ylikirjoittaa toisensa.
      </span>
      <button type="button" onClick={() => useTabs.getState().dismiss()}>
        Ymmärrän
      </button>
    </div>
  )
}

export function BackupBar() {
  const project = useStore((s) => s.project)
  const link = useStorage((s) => s.fileLink)
  const last = useStorage((s) => s.lastFileBackupAt)
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze)
  // Aika luetaan kerran näkymän avautuessa: muistutus ei tarvitse sekuntitarkkuutta.
  const [now] = useState(() => Date.now())

  if (!project) return null

  if (link && link.status !== 'ok') {
    return (
      <div className="notice notice--warn" role="status" data-testid="file-link-warning">
        <Icon name="warn" />
        <span>
          {link.status === 'needs-permission'
            ? `Tallennus tiedostoon “${link.fileName}” on tauolla, koska selain tarvitsee luvan.`
            : `Tallennus tiedostoon “${link.fileName}” epäonnistui: ${link.message ?? 'tuntematon virhe'}.`}
        </span>
        <button type="button" onClick={() => void useStorage.getState().resumeFileLink()}>
          Jatka tallennusta
        </button>
        <button type="button" onClick={() => useUi.getState().setStorageOpen(true)}>
          Asetukset
        </button>
      </div>
    )
  }

  const due = backupReminderDue({
    project,
    lastFileBackupAt: last,
    linkedAndWorking: link?.status === 'ok',
    snoozedUntil,
    now,
  })
  if (!due) return null

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS
    try {
      localStorage.setItem(SNOOZE_KEY, String(until))
    } catch {
      /* ei haittaa */
    }
    setSnoozedUntil(until)
  }

  return (
    <div className="notice" role="status" data-testid="backup-reminder">
      <Icon name="download" />
      <span>
        {last
          ? 'Viimeisimmästä tiedostovarmuuskopiosta on yli viikko, ja projektia on muokattu sen jälkeen.'
          : 'Projektista ei ole vielä tiedostovarmuuskopiota. Selaimen tiedot voivat kadota.'}
      </span>
      <button
        type="button"
        className="btn-primary"
        onClick={() => void useStorage.getState().exportJson()}
      >
        Lataa kopio nyt
      </button>
      <button type="button" onClick={() => useUi.getState().setStorageOpen(true)}>
        Tallennusasetukset
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Muistuta viikon päästä"
        onClick={snooze}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}
