import { useState } from 'react'
import { processTree } from '../model/selectors'
import { addProcess, deleteProcess, duplicateProcess } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { Menu } from '../ui/Menu'

export function ProcessTree() {
  const project = useStore((s) => s.project)!
  const currentId = useStore((s) => s.currentProcessId)
  const setCurrent = useStore((s) => s.setCurrentProcess)
  const dispatch = useStore((s) => s.dispatch)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const tree = processTree(project)

  const startRename = (id: string, name: string) => {
    setRenaming(id)
    setDraft(name)
  }
  const finishRename = (commit: boolean) => {
    if (renaming && commit && draft.trim()) {
      dispatch({ type: 'updateProcess', id: renaming, patch: { name: draft.trim() } })
    }
    setRenaming(null)
  }

  return (
    <nav className="tree" aria-label="Prosessit">
      <div className="panel__head">
        <h2 className="panel__title">Prosessit</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Uusi prosessi"
          title="Uusi prosessi"
          onClick={() => addProcess()}
        >
          <Icon name="plus" />
        </button>
      </div>
      <ul>
        {tree.map(({ process, depth }) => (
          <li key={process.id} style={{ paddingLeft: depth * 14 }}>
            {renaming === process.id ? (
              <input
                className="tree__rename"
                autoFocus
                value={draft}
                aria-label="Prosessin nimi"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(true)
                  if (e.key === 'Escape') finishRename(false)
                }}
              />
            ) : (
              <div className={`tree__row ${process.id === currentId ? 'is-current' : ''}`}>
                <button
                  type="button"
                  className="tree__name"
                  aria-current={process.id === currentId ? 'page' : undefined}
                  onClick={() => {
                    setCurrent(process.id)
                    if (window.matchMedia?.('(max-width: 900px)').matches)
                      useUi.getState().toggleLeft()
                  }}
                  onDoubleClick={() => startRename(process.id, process.name)}
                >
                  {depth > 0 && <Icon name="chevronRight" size={12} />}
                  <span>{process.name}</span>
                </button>
                <Menu
                  label={`Toiminnot: ${process.name}`}
                  triggerClassName="icon-btn"
                  trigger={<Icon name="dots" size={16} />}
                  align="right"
                  items={[
                    {
                      label: 'Nimeä uudelleen',
                      onSelect: () => startRename(process.id, process.name),
                    },
                    { label: 'Kopioi', onSelect: () => duplicateProcess(process.id) },
                    {
                      label: 'Poista',
                      danger: true,
                      separatorBefore: true,
                      disabled: process.id === project.rootProcessId,
                      onSelect: () => void deleteProcess(process.id),
                    },
                  ]}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
