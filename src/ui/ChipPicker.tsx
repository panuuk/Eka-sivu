import { useId, useMemo, useState } from 'react'
import { ensureEntity } from '../model/commands'
import { normalizeName } from '../model/selectors'
import type { EntityKind } from '../model/types'
import { entityColor } from '../model/flow'
import type { Operation } from '../model/operations'
import { useStore } from '../store/store'
import { Icon } from './Icon'

interface Props {
  kind: EntityKind
  label: string
  value: string[]
  single?: boolean
  placeholder?: string
  /** Kutsutaan uudella arvolla; `extraOps` sisältää mahdollisen uuden entiteetin luonnin. */
  onChange: (ids: string[], extraOps: Operation[]) => void
}

/** Valitsin entiteeteille (rooli, järjestelmä, syöte/tuotos): valitse olemassa oleva tai luo uusi kirjoittamalla. */
export function ChipPicker({ kind, label, value, single, placeholder, onChange }: Props) {
  const project = useStore((s) => s.project)!
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputId = useId()

  const options = useMemo(() => {
    const q = normalizeName(text)
    return Object.values(project.entities)
      .filter((e) => e.kind === kind && !value.includes(e.id))
      .filter(
        (e) =>
          !q ||
          normalizeName(e.name).includes(q) ||
          e.aliases.some((a) => normalizeName(a).includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'fi'))
      .slice(0, 8)
  }, [project.entities, kind, value, text])

  const exact = Object.values(project.entities).some(
    (e) => e.kind === kind && normalizeName(e.name) === normalizeName(text),
  )
  const canCreate = text.trim().length > 0 && !exact
  const total = options.length + (canCreate ? 1 : 0)

  const pick = (id: string, ops: Operation[] = []) => {
    onChange(single ? [id] : [...value, id], ops)
    setText('')
    setActive(0)
    if (single) setOpen(false)
  }

  const commit = (index: number) => {
    if (index < options.length) return pick(options[index].id)
    if (canCreate) {
      const { id, ops } = ensureEntity(project, kind, text)
      pick(id, ops)
    }
  }

  const remove = (id: string) =>
    onChange(
      value.filter((v) => v !== id),
      [],
    )

  const hideInput = single && value.length === 1

  return (
    <div className="field">
      <label htmlFor={inputId} className="field__label">
        {label}
      </label>
      <div className="chips">
        {value.map((id) => {
          const e = project.entities[id]
          if (!e) return null
          return (
            <span key={id} className="chip" style={{ ['--chip' as string]: entityColor(id) }}>
              <span className="chip__dot" />
              {e.name}
              <button type="button" aria-label={`Poista ${e.name}`} onClick={() => remove(id)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          )
        })}
        {!hideInput && (
          <div className="combo">
            <input
              id={inputId}
              role="combobox"
              aria-expanded={open && total > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && total > 0 ? `${listId}-${active}` : undefined}
              value={text}
              placeholder={placeholder ?? 'Lisää…'}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value)
                setOpen(true)
                setActive(0)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setOpen(true)
                  setActive((a) => Math.min(a + 1, Math.max(total - 1, 0)))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter' && text.trim()) {
                  e.preventDefault()
                  commit(active)
                } else if (e.key === 'Escape') {
                  setOpen(false)
                } else if (e.key === 'Backspace' && !text && value.length) {
                  remove(value[value.length - 1])
                }
              }}
            />
            {open && total > 0 && (
              <ul className="combo__list" role="listbox" id={listId}>
                {options.map((o, i) => (
                  <li
                    key={o.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'is-active' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(i)
                    }}
                  >
                    {o.name}
                  </li>
                ))}
                {canCreate && (
                  <li
                    id={`${listId}-${options.length}`}
                    role="option"
                    aria-selected={active === options.length}
                    className={active === options.length ? 'is-active is-create' : 'is-create'}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(options.length)
                    }}
                  >
                    Luo uusi: “{text.trim()}”
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
