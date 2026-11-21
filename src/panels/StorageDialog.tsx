import { useEffect, useRef, useState } from 'react'
import { REASON_LABELS } from '../storage/backupPolicy'
import type { BackupMeta } from '../storage/db'
import { useStore } from '../store/store'
import { useStorage } from '../store/storage'
import { useUi } from '../store/ui'
import { formatAgo, formatBytes, formatDateTime } from '../ui/format'
import { Icon } from '../ui/Icon'

function BackupRow({ b, current }: { b: BackupMeta; current: boolean }) {
  const [busy, setBusy] = useState(false)
  const restore = async (mode: 'replace' | 'copy') => {
    if (mode === 'replace') {
      const ok = await useUi.getState().ask({
        title: 'Palautetaanko varmuuskopio?',
        message:
          'Projektin nykyinen sisältö korvataan tämän kopion sisällöllä. Nykyinen tila otetaan ensin talteen varmuuskopioksi, joten palautuksen voi perua.',
        confirmLabel: 'Palauta',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      await useStorage.getState().restoreBackup(b.id, mode)
      if (mode === 'replace') useUi.getState().setStorageOpen(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="backup" data-testid="backup-row">
      <div className="backup__info">
        <strong>{formatDateTime(b.createdAt)}</strong>
        <span className="muted">
          {formatAgo(b.createdAt)} · {b.nodeCount} vaihetta · {REASON_LABELS[b.reason]}
          {!current && ` · ${b.projectName}`}
        </span>
      </div>
      <div className="backup__actions">
        <button type="button" disabled={busy} onClick={() => void restore('copy')}>
          Avaa kopiona
        </button>
        <button type="button" disabled={busy} onClick={() => void restore('replace')}>
          Palauta
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Poista varmuuskopio"
          disabled={busy}
          onClick={() => void useStorage.getState().removeBackup(b.id)}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </li>
  )
}

function FileSection() {
  const supported = useStorage((s) => s.supported)
  const link = useStorage((s) => s.fileLink)
  const lastFileBackupAt = useStorage((s) => s.lastFileBackupAt)
  const storage = useStorage.getState()

  return (
    <section className="storage__section">
      <h3>Tiedosto</h3>
      {supported ? (
        <>
          <p className="field__hint">
            Yhdistä projekti tiedostoon, niin jokainen muutos tallentuu myös levylle. Tiedosto
            säilyy, vaikka selaimen tiedot tyhjennettäisiin.
          </p>
          {link ? (
            <div className="storage__linked" data-testid="file-link">
              <Icon name="file" size={16} />
              <div>
                <strong>{link.fileName}</strong>
                <div className="muted">
                  {link.status === 'ok' && link.lastWriteAt
                    ? `Viimeksi tallennettu ${formatDateTime(link.lastWriteAt)}`
                    : link.status === 'needs-permission'
                      ? 'Selain tarvitsee luvan jatkaa tallennusta tiedostoon'
                      : link.status === 'error'
                        ? `Tallennus tiedostoon epäonnistui: ${link.message ?? ''}`
                        : 'Odottaa ensimmäistä tallennusta'}
                </div>
              </div>
              <div className="storage__linked-actions">
                {link.status !== 'ok' && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void storage.resumeFileLink()}
                  >
                    Jatka tallennusta
                  </button>
                )}
                <button type="button" onClick={() => void storage.unlinkFile()}>
                  Katkaise yhteys
                </button>
              </div>
            </div>
          ) : (
            <div className="storage__actions">
              <button type="button" onClick={() => void storage.linkToNewFile()}>
                Yhdistä uuteen tiedostoon…
              </button>
              <button type="button" onClick={() => void storage.openFromFile()}>
                Avaa tiedostosta…
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="field__hint">
          Selaimesi ei tue tallennusta suoraan tiedostoon (Chrome ja Edge tukevat). Lataa projekti
          JSON-tiedostona säännöllisesti.
        </p>
      )}
      <div className="storage__actions">
        <button type="button" onClick={() => void storage.exportJson()}>
          <Icon name="download" size={16} /> Lataa JSON-tiedosto
        </button>
        <span className="muted" data-testid="last-file-backup">
          {lastFileBackupAt
            ? `Viimeisin tiedostokopio ${formatDateTime(lastFileBackupAt)}`
            : 'Tiedostokopiota ei ole vielä otettu'}
        </span>
      </div>
    </section>
  )
}

export function StorageDialog() {
  const open = useUi((s) => s.storageOpen)
  const project = useStore((s) => s.project)
  const backups = useStorage((s) => s.backups)
  const info = useStorage((s) => s.info)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      void useStorage.getState().refresh()
      void useStorage.getState().refreshInfo()
    }
    if (!open && d.open) d.close()
  }, [open])

  const projects = useStore((s) => s.projects)
  const mine = backups.filter((b) => b.projectId === project?.id)
  const knownIds = new Set(projects.map((p) => p.id))
  const deleted = backups.filter((b) => !knownIds.has(b.projectId))

  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide dialog--storage"
      onClose={() => useUi.getState().setStorageOpen(false)}
      aria-labelledby="storage-title"
    >
      {open && project && (
        <>
          <div className="dialog__head">
            <h2 id="storage-title">Tallennus ja varmuuskopiot</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Sulje"
              onClick={() => useUi.getState().setStorageOpen(false)}
            >
              <Icon name="x" />
            </button>
          </div>

          <section className="storage__section">
            <h3>Selaimen tallennus</h3>
            <p className="field__hint">
              Työ tallentuu automaattisesti tämän selaimen tietokantaan.{' '}
              {info.persisted === true && 'Selain on merkinnyt tallennuksen pysyväksi.'}
              {info.persisted === false &&
                'Selain voi poistaa tiedot, jos levytila loppuu. Tiedostoyhteys tai JSON-kopio suojaa tältä.'}
            </p>
            <div className="storage__meta">
              <span>
                Pysyvä tallennus:{' '}
                <strong>
                  {info.persisted === null ? 'ei tietoa' : info.persisted ? 'kyllä' : 'ei'}
                </strong>
              </span>
              {info.usage !== null && (
                <span>
                  Käytössä: <strong>{formatBytes(info.usage)}</strong>
                  {info.quota ? ` / ${formatBytes(info.quota)}` : ''}
                </span>
              )}
            </div>
          </section>

          <FileSection />

          <section className="storage__section">
            <div className="storage__row">
              <h3>Varmuuskopiot: {project.name}</h3>
              <button type="button" onClick={() => void useStorage.getState().backupNow('manual')}>
                Ota kopio nyt
              </button>
            </div>
            <p className="field__hint">
              Työkalu ottaa kopion automaattisesti vähintään 10 minuutin välein, kun projektia
              muutetaan. Uusimmat 20 säilyvät, ja jokaiselta viimeiseltä 14 päivältä säilyy uusin.
            </p>
            {mine.length === 0 ? (
              <p className="muted">Ei vielä varmuuskopioita.</p>
            ) : (
              <ul className="backups" aria-label="Varmuuskopiot">
                {mine.map((b) => (
                  <BackupRow key={b.id} b={b} current />
                ))}
              </ul>
            )}
          </section>

          {deleted.length > 0 && (
            <section className="storage__section">
              <h3>Poistettujen projektien kopiot</h3>
              <ul className="backups" aria-label="Poistettujen projektien kopiot">
                {deleted.map((b) => (
                  <BackupRow key={b.id} b={b} current={false} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </dialog>
  )
}
