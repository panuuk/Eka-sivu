import { useEffect, useRef } from 'react'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

const SECTIONS: { title: string; rows: [keys: string, what: string][] }[] = [
  {
    title: 'Vaiheiden muokkaus',
    rows: [
      ['Enter', 'Lisää vaihe valitun jälkeen'],
      ['F2 tai kaksoisklikkaus', 'Nimeä vaihe uudelleen'],
      ['Delete', 'Poista valinta'],
      ['Ctrl+C, Ctrl+V', 'Kopioi ja liitä vaiheet (myös toiseen prosessiin)'],
      ['Ctrl+Z, Ctrl+Shift+Z', 'Kumoa, tee uudelleen'],
      ['Ctrl+H', 'Etsi ja korvaa'],
    ],
  },
  {
    title: 'Liikkuminen',
    rows: [
      ['↓ ↑', 'Seuraava ja edellinen vaihe prosessin kulussa'],
      ['← →', 'Vaihtoehtoinen haara (esim. päätöksen kyllä/ei)'],
      ['/', 'Hae vaiheita'],
      ['Esc', 'Tyhjennä valinta'],
      ['Ctrl+klikkaus, Shift+vetäminen', 'Valitse useita vaiheita'],
    ],
  },
  {
    title: 'Syöttö ja esittäminen',
    rows: [
      ['Ctrl+K', 'Pikasyöte: kirjoita prosessi tekstinä'],
      ['?', 'Tämä ohje'],
      ['Esitä-painike', 'Siisti koko ruudun esitys, ← → liikkuu vaiheesta toiseen'],
    ],
  },
]

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen)
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
      onClose={() => useUi.getState().setHelpOpen(false)}
      aria-labelledby="help-title"
    >
      {open && (
        <>
          <div className="dialog__head">
            <h2 id="help-title">Pikanäppäimet ja ohje</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Sulje"
              onClick={() => useUi.getState().setHelpOpen(false)}
            >
              <Icon name="x" />
            </button>
          </div>
          {SECTIONS.map((s) => (
            <section key={s.title} className="help__section">
              <h3>{s.title}</h3>
              <dl className="help__rows">
                {s.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </>
      )}
    </dialog>
  )
}
