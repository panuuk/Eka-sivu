import { useEffect, useMemo, useRef, useState } from 'react'
import { opsReplace, planReplace, type ReplaceField } from '../analysis/replace'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

const FIELD_LABELS: Record<ReplaceField, string> = {
  label: 'Nimet',
  description: 'Kuvaukset',
  notes: 'Muistiinpanot',
}

/** Etsi ja korvaa vaiheiden teksteistä (Ctrl+H). Esikatselu näyttää muutokset ennen korvausta. */
export function ReplaceDialog() {
  const open = useUi((s) => s.replaceOpen)
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
      onClose={() => useUi.getState().setReplaceOpen(false)}
      aria-labelledby="replace-title"
    >
      {open && <ReplaceBody />}
    </dialog>
  )
}

function ReplaceBody() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const initial = useUi.getState().filter.text
  const [find, setFind] = useState(initial)
  const [replace, setReplace] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [scope, setScope] = useState<'process' | 'project'>('process')
  const [fields, setFields] = useState<ReplaceField[]>(['label'])

  const changes = useMemo(
    () =>
      planReplace(project, {
        find,
        replace,
        caseSensitive,
        fields,
        processId: scope === 'process' ? processId : undefined,
      }),
    [project, find, replace, caseSensitive, fields, scope, processId],
  )
  const total = changes.reduce((n, c) => n + c.count, 0)
  const toggle = (f: ReplaceField) =>
    setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))

  const apply = () => {
    const ops = opsReplace(changes)
    if (ops.length && useStore.getState().dispatch(ops)) useUi.getState().setReplaceOpen(false)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <div className="dialog__head">
        <h2 id="replace-title">Etsi ja korvaa</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Sulje"
          onClick={() => useUi.getState().setReplaceOpen(false)}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="replace__grid">
        <label className="field">
          <span className="field__label">Etsi</span>
          <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Korvaa tekstillä</span>
          <input value={replace} onChange={(e) => setReplace(e.target.value)} />
        </label>
      </div>
      <div className="replace__options">
        <label>
          <span className="field__label">Missä</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'process' | 'project')}>
            <option value="process">Tämä prosessi</option>
            <option value="project">Koko projekti</option>
          </select>
        </label>
        {(Object.keys(FIELD_LABELS) as ReplaceField[]).map((f) => (
          <label key={f} className="check">
            <input type="checkbox" checked={fields.includes(f)} onChange={() => toggle(f)} />
            {FIELD_LABELS[f]}
          </label>
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Erota isot ja pienet kirjaimet
        </label>
      </div>

      <div className="replace__preview" data-testid="replace-preview">
        {!find ? (
          <p className="muted">Kirjoita etsittävä teksti.</p>
        ) : changes.length === 0 ? (
          <p className="muted">Ei osumia.</p>
        ) : (
          <ul>
            {changes.slice(0, 8).map((c) => (
              <li key={`${c.nodeId}-${c.field}`}>
                <del>{c.before}</del> <ins>{c.after}</ins>
              </li>
            ))}
            {changes.length > 8 && <li className="muted">… ja {changes.length - 8} muuta</li>}
          </ul>
        )}
      </div>

      <div className="dialog__actions">
        <button type="button" onClick={() => useUi.getState().setReplaceOpen(false)}>
          Peruuta
        </button>
        <button type="submit" className="btn-primary" disabled={changes.length === 0}>
          Korvaa {total > 0 ? `${total} kohtaa` : ''}
        </button>
      </div>
    </form>
  )
}
