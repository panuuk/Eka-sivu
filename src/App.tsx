import { useEffect } from 'react'
import { Canvas } from './canvas/Canvas'
import { EntityManager } from './panels/EntityManager'
import { Inspector } from './panels/Inspector'
import { ListView } from './panels/ListView'
import { ProcessTree } from './panels/ProcessTree'
import { QuickInput } from './panels/QuickInput'
import { useStore } from './store/store'
import { useUi } from './store/ui'
import { ConfirmHost, PromptHost } from './ui/ConfirmHost'
import { ErrorBar } from './ui/ErrorBar'
import { TopBar } from './ui/TopBar'
import { useShortcuts } from './ui/useShortcuts'
import './app.css'

function App() {
  const ready = useStore((s) => s.ready)
  const view = useUi((s) => s.view)
  const leftOpen = useUi((s) => s.leftOpen)
  const rightOpen = useUi((s) => s.rightOpen)
  useShortcuts()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  if (!ready) return <div className="loading">Ladataan…</div>

  return (
    <div className="app">
      <TopBar />
      <ErrorBar />
      <div className={`workspace ${leftOpen ? 'has-left' : ''} ${rightOpen ? 'has-right' : ''}`}>
        {leftOpen && (
          <div className="workspace__left">
            <ProcessTree />
          </div>
        )}
        <main className="workspace__main" id="main">
          {view === 'canvas' ? <Canvas /> : <ListView />}
        </main>
        {rightOpen && (
          <div className="workspace__right">
            <Inspector />
          </div>
        )}
      </div>
      <EntityManager />
      <QuickInput />
      <ConfirmHost />
      <PromptHost />
    </div>
  )
}

export default App
