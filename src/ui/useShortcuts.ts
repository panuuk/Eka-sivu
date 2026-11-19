import { useEffect } from 'react'
import { addNode, deleteSelection } from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Yleiset pikanäppäimet. Kirjoitettaessa kenttään vain kumoa/tee uudelleen toimivat. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const inDialog = e.target instanceof HTMLElement && !!e.target.closest('dialog')
      if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !inDialog) {
        e.preventDefault()
        if (e.shiftKey) useStore.getState().redo()
        else useStore.getState().undo()
        return
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'y' && !inDialog) {
        e.preventDefault()
        useStore.getState().redo()
        return
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (useUi.getState().quickOpen) useUi.getState().closeQuick()
        else useUi.getState().openQuick('add')
        return
      }
      if (isTyping(e.target) || inDialog || mod || e.altKey) return
      const sel = useStore.getState().selection
      if (e.key === 'Enter' && sel.nodeIds.length === 1 && sel.edgeIds.length === 0) {
        // Enter lisää seuraavan vaiheen, mutta ei jos fokus on painikkeella (se käsittelee Enterin itse).
        if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="menuitem"]'))
          return
        e.preventDefault()
        addNode('step')
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        sel.nodeIds.length + sel.edgeIds.length > 0
      ) {
        e.preventDefault()
        void deleteSelection()
      } else if (e.key === 'F2' && sel.nodeIds.length === 1) {
        e.preventDefault()
        useUi.getState().setEditNode(sel.nodeIds[0])
      } else if (e.key === 'Escape' && sel.nodeIds.length + sel.edgeIds.length > 0) {
        useStore.getState().select({ nodeIds: [], edgeIds: [] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
