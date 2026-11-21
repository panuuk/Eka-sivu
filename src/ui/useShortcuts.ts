import { useEffect } from 'react'
import {
  addNode,
  copySelection,
  deleteSelection,
  moveSelection,
  pasteSelection,
  type MoveDirection,
} from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * Nuolinäppäimet liikuttavat valintaa prosessin kulussa. Kuuntelija on sieppausvaiheessa ja
 * pysäyttää tapahtuman, jotta React Flow ei siirrä valittua vaihetta nuolinäppäimellä.
 */
function onArrowKey(e: KeyboardEvent) {
  if (useUi.getState().presenting) return
  const inDialog = e.target instanceof HTMLElement && !!e.target.closest('dialog')
  if (isTyping(e.target) || inDialog || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  if (useUi.getState().view !== 'canvas' || !e.key.startsWith('Arrow')) return
  if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="menuitem"]')) return
  const { layoutMode, direction } = useUi.getState()
  const horizontal = layoutMode === 'lanes' || direction === 'RIGHT'
  const map: Record<string, MoveDirection> = horizontal
    ? { ArrowRight: 'next', ArrowLeft: 'prev', ArrowDown: 'sibling-next', ArrowUp: 'sibling-prev' }
    : { ArrowDown: 'next', ArrowUp: 'prev', ArrowRight: 'sibling-next', ArrowLeft: 'sibling-prev' }
  const dir = map[e.key]
  if (!dir) return
  e.preventDefault()
  e.stopPropagation()
  moveSelection(dir)
}

/** Yleiset pikanäppäimet. Kirjoitettaessa kenttään vain kumoa/tee uudelleen toimivat. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esitystilassa mikään muokkaus ei saa tapahtua vahingossa
      if (useUi.getState().presenting) return
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
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h' && !inDialog) {
        e.preventDefault()
        useUi.getState().setReplaceOpen(true)
        return
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (useUi.getState().quickOpen) useUi.getState().closeQuick()
        else useUi.getState().openQuick('add')
        return
      }
      const noText = !isTyping(e.target) && !inDialog && !e.altKey
      const view = useUi.getState().view
      const selectedText = window.getSelection()?.toString() ?? ''
      // Ctrl+C ja Ctrl+V käsittelevät vaiheita vain, kun tekstiä ei ole valittuna ja ollaan kaaviossa tai listassa
      if (mod && noText && !e.shiftKey && view !== 'sources' && !selectedText) {
        const k = e.key.toLowerCase()
        if (k === 'c' && useStore.getState().selection.nodeIds.length > 0) {
          if (copySelection()) e.preventDefault()
          return
        }
        if (k === 'v') {
          if (pasteSelection()) e.preventDefault()
          return
        }
      }
      if (isTyping(e.target) || inDialog || mod || e.altKey) return
      if (e.key === '?') {
        e.preventDefault()
        useUi.getState().setHelpOpen(true)
        return
      }
      if (e.key === '/' && !e.shiftKey) {
        const el = document.getElementById('global-search')
        if (el) {
          e.preventDefault()
          el.focus()
          return
        }
      }
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
    window.addEventListener('keydown', onArrowKey, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onArrowKey, true)
    }
  }, [])
}
