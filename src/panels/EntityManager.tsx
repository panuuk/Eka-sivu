import { useEffect, useRef, useState } from 'react'
import { opsMergeEntities } from '../model/commands'
import { createEntity } from '../model/factory'
import { entityUsage, entitiesOfKind } from '../model/selectors'
import { ENTITY_LABELS, type Entity, type EntityKind } from '../model/types'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

const KINDS: EntityKind[] = ['role', 'system', 'artifact']
const PLURAL: Record<EntityKind, string> = {
  role: 'Roolit',
  system: 'Järjestelmät',
  artifact: 'Syötteet ja tuotokset',
}

function EntityRow({ entity }: { entity: Entity }) {
  const project = useStore((s) => s.project)!
  const dispatch = useStore((s) => s.dispatch)
  const usage = entityUsage(project, entity.id)
  const others = entitiesOfKind(project, entity.kind).filter((e) => e.id !== entity.id)
  return (
    <li className="entity-row">
      <div className="entity-row__main">
        <input
          aria-label={`Nimi: ${entity.name}`}
          value={entity.name}
          onChange={(e) =>
            dispatch(
              { type: 'updateEntity', id: entity.id, patch: { name: e.target.value } },
              { coalesceKey: `ent:${entity.id}` },
            )
          }
        />
        <input
          aria-label={`Vaihtoehtoiset nimet: ${entity.name}`}
          placeholder="Vaihtoehtoiset nimet pilkulla erotettuna"
          defaultValue={entity.aliases.join(', ')}
          onBlur={(e) =>
            dispatch({
              type: 'updateEntity',
              id: entity.id,
              patch: {
                aliases: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      </div>
      <span className="muted entity-row__usage">{usage} käyttöä</span>
      {others.length > 0 && (
        <select
          aria-label={`Yhdistä ${entity.name} toiseen`}
          value=""
          onChange={async (e) => {
            const target = project.entities[e.target.value]
            if (!target) return
            const ok = await useUi.getState().ask({
              title: 'Yhdistetäänkö?',
              message: `“${entity.name}” yhdistetään kohteeseen “${target.name}”. Kaikki viittaukset siirtyvät, ja nimi jää vaihtoehtoiseksi nimeksi.`,
              confirmLabel: 'Yhdistä',
            })
            if (ok) dispatch(opsMergeEntities(project, entity.id, target.id))
          }}
        >
          <option value="">Yhdistä…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={`Poista ${entity.name}`}
        onClick={async () => {
          if (usage > 0) {
            const ok = await useUi.getState().ask({
              title: `Poistetaanko “${entity.name}”?`,
              message: `Se on käytössä ${usage} vaiheessa, ja viittaukset poistetaan.`,
              confirmLabel: 'Poista',
              danger: true,
            })
            if (!ok) return
          }
          dispatch({ type: 'deleteEntity', id: entity.id })
        }}
      >
        <Icon name="trash" size={16} />
      </button>
    </li>
  )
}

export function EntityManager() {
  const open = useUi((s) => s.entityManagerOpen)
  const setOpen = useUi((s) => s.setEntityManagerOpen)
  const project = useStore((s) => s.project)
  const dispatch = useStore((s) => s.dispatch)
  const [kind, setKind] = useState<EntityKind>('role')
  const [name, setName] = useState('')
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const list = project ? entitiesOfKind(project, kind) : []
  const add = () => {
    const n = name.trim()
    if (!n) return
    dispatch({ type: 'addEntity', entity: createEntity(kind, n) })
    setName('')
  }

  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide"
      onClose={() => setOpen(false)}
      aria-labelledby="entities-title"
    >
      <div className="dialog__head">
        <h2 id="entities-title">Roolit, järjestelmät ja tuotokset</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Sulje"
          onClick={() => setOpen(false)}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'is-on' : ''}
            onClick={() => setKind(k)}
          >
            {PLURAL[k]}
          </button>
        ))}
      </div>
      <form
        className="entity-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          aria-label={`Uusi: ${ENTITY_LABELS[kind]}`}
          placeholder={`Lisää: ${ENTITY_LABELS[kind].toLowerCase()}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Lisää
        </button>
      </form>
      {list.length === 0 ? (
        <p className="muted">Ei vielä yhtään. Lisää tässä tai suoraan vaiheen ominaisuuksista.</p>
      ) : (
        <ul className="entity-list">
          {list.map((e) => (
            <EntityRow key={e.id} entity={e} />
          ))}
        </ul>
      )}
    </dialog>
  )
}
