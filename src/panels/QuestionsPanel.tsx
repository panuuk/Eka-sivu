import { useState } from 'react'
import { opsRestoreGap } from '../analysis/fixes'
import type { Gap } from '../analysis/gaps'
import { useAnalysis } from '../analysis/useAnalysis'
import { newId } from '../model/ids'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { GapAnswer } from './GapAnswer'

const SEVERITY_LABEL = { high: 'Tärkeä', medium: 'Keskitärkeä', low: 'Pieni' }

/** Siirtyy kaavioon kysymyksen kohteeseen. */
function showTarget(processId: string, targetId?: string) {
  const s = useStore.getState()
  s.setCurrentProcess(processId)
  if (targetId) s.select({ nodeIds: [targetId], edgeIds: [] })
  useUi.getState().setView('canvas')
}

export function ReadinessCard({ processId, compact }: { processId: string; compact?: boolean }) {
  const analysis = useAnalysis()
  const r = analysis.readiness(processId)
  if (r.nodes === 0) {
    return compact ? null : (
      <p className="muted">Ei vielä vaiheita, joten valmiusastetta ei voi laskea.</p>
    )
  }
  return (
    <div className="readiness" data-testid="readiness">
      <div className="readiness__head">
        <strong>{r.percent} %</strong>
        <span>valmis</span>
      </div>
      <div
        className="readiness__bar"
        role="progressbar"
        aria-valuenow={r.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Prosessin valmiusaste"
      >
        <div style={{ width: `${r.percent}%` }} />
      </div>
      <p className="readiness__facts">
        {r.openQuestions} {r.openQuestions === 1 ? 'avoin kysymys' : 'avointa kysymystä'} ·{' '}
        {r.guesses} {r.guesses === 1 ? 'arvaus' : 'arvausta'} · {r.confirmed}/{r.nodes} vahvistettu
      </p>
    </div>
  )
}

function GapCard({ gap }: { gap: Gap }) {
  const project = useStore((s) => s.project)!
  const processName = project.processes[gap.processId]?.name
  return (
    <li className={`gap gap--${gap.severity}`} data-testid="gap" data-rule={gap.rule}>
      <div className="gap__head">
        <span
          className={`gap__dot gap__dot--${gap.severity}`}
          title={SEVERITY_LABEL[gap.severity]}
        />
        <p className="gap__text">{gap.text}</p>
      </div>
      <p className="gap__meta">
        {processName}
        <button
          type="button"
          className="linklike"
          onClick={() => showTarget(gap.processId, gap.targetId)}
        >
          Näytä
        </button>
      </p>
      <GapAnswer gap={gap} project={project} />
    </li>
  )
}

function CustomQuestions({ processId }: { processId: string }) {
  const project = useStore((s) => s.project)!
  const selection = useStore((s) => s.selection)
  const analysis = useAnalysis()
  const dispatch = useStore((s) => s.dispatch)
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const target = selection.nodeIds.length === 1 ? project.nodes[selection.nodeIds[0]] : undefined

  const list = analysis.custom.filter((q) => q.processId === processId)

  const add = () => {
    const t = text.trim()
    if (!t) return
    const id = newId('q')
    dispatch({
      type: 'addQuestion',
      question: {
        id,
        processId,
        ...(target && target.processId === processId ? { targetId: target.id } : {}),
        rule: 'custom',
        text: t,
        status: 'open',
        key: `custom:${id}`,
      },
    })
    setText('')
  }

  return (
    <section className="custom-q" aria-label="Omat kysymykset">
      <h3 className="panel__title">Omat kysymykset</h3>
      <form
        className="gap-row"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          aria-label="Oma kysymys"
          placeholder={target ? `Kysymys vaiheesta “${target.label}”…` : 'Kysymys prosessista…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim()}>
          Lisää
        </button>
      </form>
      <ul className="gap-list">
        {list.map((q) => {
          const t = q.targetId ? project.nodes[q.targetId] : undefined
          return (
            <li
              key={q.id}
              className={`gap gap--custom ${q.status === 'answered' ? 'is-answered' : ''}`}
            >
              <p className="gap__text">{q.text}</p>
              {t && <p className="gap__meta">Vaihe: {t.label}</p>}
              {q.status === 'answered' ? (
                <>
                  <p className="gap-quote">{q.answer}</p>
                  <div className="gap-row">
                    <button
                      type="button"
                      className="linklike"
                      onClick={() =>
                        dispatch({ type: 'updateQuestion', id: q.id, patch: { status: 'open' } })
                      }
                    >
                      Avaa uudelleen
                    </button>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => dispatch({ type: 'deleteQuestion', id: q.id })}
                    >
                      Poista
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    aria-label={`Vastaus: ${q.text}`}
                    rows={2}
                    placeholder="Vastaus"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  />
                  <div className="gap-row">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!answers[q.id]?.trim()}
                      onClick={() =>
                        dispatch({
                          type: 'updateQuestion',
                          id: q.id,
                          patch: { status: 'answered', answer: answers[q.id].trim() },
                        })
                      }
                    >
                      Merkitse vastatuksi
                    </button>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => dispatch({ type: 'deleteQuestion', id: q.id })}
                    >
                      Poista
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function QuestionsPanel() {
  const processId = useStore((s) => s.currentProcessId)
  const project = useStore((s) => s.project)!
  const analysis = useAnalysis()
  const [scope, setScope] = useState<'process' | 'all'>('process')
  const [showDismissed, setShowDismissed] = useState(false)

  const open =
    scope === 'process' ? analysis.open.filter((g) => g.processId === processId) : analysis.open
  const dismissed =
    scope === 'process'
      ? analysis.dismissed.filter((g) => g.processId === processId)
      : analysis.dismissed

  return (
    <aside className="inspector questions" aria-label="Kysymykset">
      <h2 className="panel__title">Kysymykset</h2>
      <div className="inspector__body">
        <ReadinessCard processId={processId} />
        <div className="segmented segmented--compact" role="radiogroup" aria-label="Rajaus">
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'process'}
            className={scope === 'process' ? 'is-on' : ''}
            onClick={() => setScope('process')}
          >
            Tämä prosessi
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'all'}
            className={scope === 'all' ? 'is-on' : ''}
            onClick={() => setScope('all')}
          >
            Kaikki ({analysis.open.length})
          </button>
        </div>

        {open.length === 0 ? (
          <p className="questions__done" role="status">
            <Icon name="check" size={16} /> Ei avoimia aukkoja
            {scope === 'process' ? ' tässä prosessissa' : ''}.
          </p>
        ) : (
          <ul className="gap-list" aria-label="Avoimet kysymykset">
            {open.map((g) => (
              <GapCard key={g.key} gap={g} />
            ))}
          </ul>
        )}

        {dismissed.length > 0 && (
          <div className="dismissed">
            <button
              type="button"
              className="linklike"
              aria-expanded={showDismissed}
              onClick={() => setShowDismissed((v) => !v)}
            >
              {showDismissed ? 'Piilota' : 'Näytä'} ohitetut ({dismissed.length})
            </button>
            {showDismissed && (
              <ul className="gap-list">
                {dismissed.map((g) => (
                  <li key={g.key} className="gap is-dismissed">
                    <p className="gap__text">{g.text}</p>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => useStore.getState().dispatch(opsRestoreGap(project, g.key))}
                    >
                      Palauta
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <CustomQuestions processId={processId} />
      </div>
    </aside>
  )
}
