import { useEffect, useRef, useState } from 'react'
import { useUi } from '../store/ui'

/** Vahvistusikkuna, jota `useUi().ask()` käyttää. Natiivi <dialog> hoitaa fokuksen ja Escin. */
export function ConfirmHost() {
  const confirm = useUi((s) => s.confirm)
  const close = useUi((s) => s.closeConfirm)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (confirm && !d.open) d.showModal()
    if (!confirm && d.open) d.close()
  }, [confirm])

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={() => close(false)}
      aria-labelledby="confirm-title"
    >
      {confirm && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault()
            close(true)
          }}
        >
          <h2 id="confirm-title">{confirm.title}</h2>
          <p>{confirm.message}</p>
          <div className="dialog__actions">
            <button type="button" onClick={() => close(false)} autoFocus={confirm.danger}>
              Peruuta
            </button>
            <button
              type="submit"
              className={confirm.danger ? 'btn-danger' : 'btn-primary'}
              autoFocus={!confirm.danger}
            >
              {confirm.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

/** Tekstikysely (esim. nimeäminen), jota `useUi().prompt()` käyttää. */
export function PromptHost() {
  const req = useUi((s) => s.promptReq)
  const close = useUi((s) => s.closePrompt)
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (req && !d.open) {
      setValue(req.initial)
      d.showModal()
    }
    if (!req && d.open) d.close()
  }, [req])

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={() => close(null)}
      aria-labelledby="prompt-title"
    >
      {req && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault()
            close(value.trim() || null)
          }}
        >
          <h2 id="prompt-title">{req.title}</h2>
          <label className="field__label" htmlFor="prompt-input">
            {req.label}
          </label>
          <input
            id="prompt-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <div className="dialog__actions">
            <button type="button" onClick={() => close(null)}>
              Peruuta
            </button>
            <button type="submit" className="btn-primary" disabled={!value.trim()}>
              {req.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
