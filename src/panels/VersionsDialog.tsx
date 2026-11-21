import { useEffect, useRef, useState } from 'react'
import { createTargetProject, restoreVersionAction, saveVersion } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { formatAgo, formatDateTime } from '../ui/format'
import { Icon } from '../ui/Icon'

/** Nimetyt versiot: tallenna, vertaa, palauta ja tee tavoitetila nykytilasta. */
export function VersionsDialog() {
  const open = useUi((s) => s.versionsOpen)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide"
      onClose={() => useUi.getState().setVersionsOpen(false)}
      aria-labelledby="versions-title"
    >
      {open && <VersionsBody />}
    </dialog>
  )
}

function VersionsBody() {
  const project = useStore((s) => s.project)!
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const versions = Object.values(project.versions ?? {}).sort((a, b) => b.createdAt - a.createdAt)
  const close = () => useUi.getState().setVersionsOpen(false)

  const save = () => {
    if (saveVersion(name || `Versio ${versions.length + 1}`, comment)) {
      setName('')
      setComment('')
    }
  }

  return (
    <>
      <div className="dialog__head">
        <h2 id="versions-title">Versiot ja tavoitetila</h2>
        <button type="button" className="icon-btn" aria-label="Sulje" onClick={close}>
          <Icon name="x" />
        </button>
      </div>

      <section className="storage__section">
        <h3>Tallenna nykytila versioksi</h3>
        <p className="field__hint">
          Versio on projektin tila tietyllä hetkellä. Sen kanssa voi verrata myöhempää tilaa ja sen
          voi palauttaa. Versiot kulkevat mukana projektin vienneissä.
        </p>
        <form
          className="versions__form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="field">
            <span className="field__label">Nimi</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Versio ${versions.length + 1}`}
            />
          </label>
          <label className="field">
            <span className="field__label">Kommentti (valinnainen)</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" data-testid="version-save">
            Tallenna versio
          </button>
        </form>
      </section>

      <section className="storage__section">
        <h3>Tavoitetila</h3>
        <p className="field__hint">
          Luo nykytilasta kopio, jota muokkaat tavoitetilaksi. Vaiheet säilyttävät tunnisteensa,
          joten vertailu tietää, mikä on lisätty, poistettu tai muuttunut. Alkuperäinen projekti ei
          muutu.
        </p>
        <button
          type="button"
          data-testid="create-target"
          onClick={async () => {
            close()
            await createTargetProject()
          }}
        >
          Luo tavoitetila nykytilasta
        </button>
      </section>

      <section className="storage__section">
        <h3>Versiot ({versions.length})</h3>
        {versions.length === 0 ? (
          <p className="muted">Ei vielä versioita.</p>
        ) : (
          <ul className="backups" data-testid="version-list">
            {versions.map((v) => (
              <li className="backup" key={v.id} data-testid="version-row">
                <div className="backup__info">
                  <strong>
                    {v.name}
                    {v.kind === 'baseline' && <span className="tag"> lähtötilanne</span>}
                  </strong>
                  <span className="muted">
                    {formatDateTime(v.createdAt)} ({formatAgo(v.createdAt)}) ·{' '}
                    {Object.keys(v.snapshot.nodes).length} vaihetta
                    {v.comment ? ` · ${v.comment}` : ''}
                  </span>
                </div>
                <div className="backup__actions">
                  <button
                    type="button"
                    onClick={() => {
                      useUi.getState().setCompare(v.id, 'current')
                      useUi.getState().setView('compare')
                      close()
                    }}
                  >
                    Vertaa nykytilaan
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await restoreVersionAction(v.id)) close()
                    }}
                  >
                    Palauta
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const n = await useUi.getState().prompt({
                        title: 'Nimeä versio',
                        label: 'Nimi',
                        initial: v.name,
                        confirmLabel: 'Tallenna',
                      })
                      if (n)
                        useStore
                          .getState()
                          .dispatch({ type: 'updateVersion', id: v.id, patch: { name: n } })
                    }}
                  >
                    Nimeä
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Poista versio ${v.name}`}
                    onClick={async () => {
                      const ok = await useUi.getState().ask({
                        title: `Poistetaanko versio “${v.name}”?`,
                        message: 'Voit kumota poiston (Ctrl+Z).',
                        confirmLabel: 'Poista',
                        danger: true,
                      })
                      if (ok) useStore.getState().dispatch({ type: 'deleteVersion', id: v.id })
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
