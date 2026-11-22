import { useAnalysis } from '../analysis/useAnalysis'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Inspector } from './Inspector'
import { QuestionsPanel } from './QuestionsPanel'

/** Oikea paneeli: vaiheen ominaisuudet tai kysymysjono. */
export function RightPanel() {
  const tab = useUi((s) => s.rightTab)
  const analysis = useAnalysis()
  const processId = useStore((s) => s.currentProcessId)
  const count =
    analysis.open.filter((g) => g.processId === processId).length +
    analysis.custom.filter((q) => q.status === 'open' && q.processId === processId).length

  return (
    <div className="rightpanel">
      <div className="tabs tabs--compact tabs--panel" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'props'}
          className={tab === 'props' ? 'is-on' : ''}
          onClick={() => useUi.getState().setRightTab('props')}
        >
          Ominaisuudet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'questions'}
          className={tab === 'questions' ? 'is-on' : ''}
          onClick={() => useUi.getState().setRightTab('questions')}
          data-testid="questions-tab"
        >
          Kysymykset{count > 0 ? ` (${count})` : ''}
        </button>
      </div>
      {tab === 'props' ? <Inspector /> : <QuestionsPanel />}
    </div>
  )
}
