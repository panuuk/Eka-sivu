import type { Project } from '../model/types'

/**
 * Kevyt koukkulista, jolla tallennuksen sivuvaikutukset (varmuuskopiot, tiedostokirjoitus)
 * liitetään storeen ilman kehäriippuvuutta.
 */
type Hook = (project: Project) => void

const saved: Hook[] = []
const activated: Hook[] = []

export const onProjectSaved = (fn: Hook) => void saved.push(fn)
export const onProjectActivated = (fn: Hook) => void activated.push(fn)

function run(list: Hook[], p: Project) {
  for (const fn of list) {
    try {
      fn(p)
    } catch (e) {
      // Sivuvaikutusten virhe ei saa estää varsinaista tallennusta.
      console.error(e)
    }
  }
}

export const runProjectSaved = (p: Project) => run(saved, p)
export const runProjectActivated = (p: Project) => run(activated, p)
