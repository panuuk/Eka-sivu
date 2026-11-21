// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

function mount(node: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return { root, container }
}

let broken = true
const Bomb = ({ explode }: { explode?: boolean }) => {
  if (explode ?? broken) throw new Error('rikki')
  return createElement('p', null, 'toimii')
}

describe('ErrorBoundary', () => {
  it('näyttää varanäkymän virheestä ja palautuu resetillä', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    broken = true
    const render = () =>
      createElement(
        ErrorBoundary,
        {
          fallback: (e: Error, reset: () => void) =>
            createElement('button', { onClick: reset, id: 'retry' }, `virhe: ${e.message}`),
        },
        createElement(Bomb),
      )
    const { container } = mount(render())
    expect(container.textContent).toBe('virhe: rikki')
    broken = false
    act(() => (container.querySelector('#retry') as HTMLButtonElement).click())
    expect(container.textContent).toBe('toimii')
  })

  it('nollautuu, kun resetKey vaihtuu', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const render = (key: string, explode: boolean) =>
      createElement(
        ErrorBoundary,
        { resetKey: key, fallback: () => createElement('i', null, 'varanäkymä') },
        createElement(Bomb, { explode }),
      )
    const { root, container } = mount(render('a', true))
    expect(container.textContent).toBe('varanäkymä')
    act(() => root.render(render('b', false)))
    expect(container.textContent).toBe('toimii')
  })
})
