import { useMemo, useState } from 'react'
import { buildTemplates, type AiTemplate } from '../capture/aiPrompt'
import { useAnalysis } from '../analysis/useAnalysis'
import { useStore } from '../store/store'

/**
 * Kopioitavat ohjepohjat tekoälylle (ChatGPT, Gemini, Claude jne.). Sovellus ei ota yhteyttä
 * mihinkään palveluun: käyttäjä kopioi tekstin itse. Teksti näytetään ennen kopiointia, koska se
 * voi sisältää prosessin nimiä, rooleja ja kuvauksia.
 */
export function AiAssist() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const analysis = useAnalysis()
  const templates = useMemo(
    () => buildTemplates(project, processId, analysis.open),
    [project, processId, analysis.open],
  )
  const [selected, setSelected] = useState<AiTemplate['id'] | null>(null)
  const [copied, setCopied] = useState<AiTemplate['id'] | null>(null)
  const current = templates.find((t) => t.id === selected)

  const copy = async (t: AiTemplate) => {
    try {
      await navigator.clipboard.writeText(t.text)
      setCopied(t.id)
      setTimeout(() => setCopied((c) => (c === t.id ? null : c)), 2500)
    } catch {
      useStore.getState().setError('Kopiointi ei onnistunut. Valitse teksti ja kopioi käsin.')
    }
  }

  return (
    <details className="quick__ai" data-testid="ai-assist">
      <summary>Tekoälyn apu</summary>
      <p className="field__hint">
        Valitse ohje, kopioi se mihin tahansa tekoälyyn ja liitä vastaus takaisin tähän. Sovellus ei
        lähetä mitään itse.
      </p>
      <div className="quick__ai-list" role="group" aria-label="Ohjepohjat">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={selected === t.id ? 'is-on' : ''}
            aria-pressed={selected === t.id}
            onClick={() => setSelected(selected === t.id ? null : t.id)}
            data-testid={`ai-template-${t.id}`}
          >
            <b>{t.title}</b>
            <span>{t.description}</span>
          </button>
        ))}
      </div>
      {current && (
        <div className="quick__ai-preview">
          <p className="field__hint">{current.usage}</p>
          <label className="field__label" htmlFor="ai-prompt-text">
            Kopioitava teksti ({current.text.length.toLocaleString('fi-FI')} merkkiä)
          </label>
          <textarea
            id="ai-prompt-text"
            readOnly
            rows={8}
            value={current.text}
            data-testid="ai-prompt-text"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-primary"
            data-testid="copy-ai-prompt"
            onClick={() => void copy(current)}
          >
            {copied === current.id ? 'Kopioitu' : 'Kopioi ohje'}
          </button>
        </div>
      )}
    </details>
  )
}
