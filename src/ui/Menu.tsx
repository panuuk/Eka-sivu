import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  separatorBefore?: boolean
}

interface Props {
  trigger: ReactNode
  label: string
  items: MenuItem[]
  align?: 'left' | 'right'
  className?: string
  triggerClassName?: string
}

/** Pieni valikko: Esc sulkee, nuolinäppäimet liikkuvat, klikkaus ulkopuolella sulkee. */
export function Menu({
  trigger,
  label,
  items,
  align = 'left',
  className,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open)
      rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      rootRef.current?.querySelector<HTMLElement>('button')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const els = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    )
    if (!els.length) return
    e.preventDefault()
    const i = els.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length
    els[next].focus()
  }

  return (
    <div className={`menu ${className ?? ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu__list menu__list--${align}`} role="menu" id={id} aria-label={label}>
          {items.map((it, i) => (
            <div key={i} className="menu__row">
              {it.separatorBefore && <hr className="menu__sep" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={it.danger ? 'menu__item menu__item--danger' : 'menu__item'}
                onClick={() => {
                  setOpen(false)
                  it.onSelect()
                }}
              >
                <span className="menu__check">{it.checked ? '✓' : ''}</span>
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
