import { useEffect, useRef, useState } from 'react'
import {
  currentRequest,
  FORMATS,
  buildSvg,
  previewText,
  runExport,
  type ExportFormat,
} from '../export/run'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { PresentSettings } from './PresentSettings'

const IMAGE_FORMATS: ExportFormat[] = ['svg', 'png', 'pdf']

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen)
  const project = useStore((s) => s.project)
  const processId = useStore((s) => s.currentProcessId)
  const theme = useUi((s) => s.theme)
  const options = useUi((s) => s.present)
  const direction = useUi((s) => s.direction)
  const ref = useRef<HTMLDialogElement>(null)

  const [format, setFormat] = useState<ExportFormat>('svg')
  const [includeQuestions, setIncludeQuestions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ kind: 'svg' | 'text' | 'none'; content: string }>({
    kind: 'none',
    content: '',
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Esikatselu päivittyy, kun muoto, asetukset tai malli muuttuvat
  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    const req = currentRequest(project, processId)
    ;(async () => {
      try {
        if (IMAGE_FORMATS.includes(format) || format === 'html' || format === 'document') {
          const svg = await buildSvg(req)
          if (!cancelled) setPreview({ kind: 'svg', content: svg })
        } else {
          const text = await previewText(format, req)
          if (!cancelled) setPreview({ kind: text ? 'text' : 'none', content: text ?? '' })
        }
        if (!cancelled) setError(null)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, project, processId, format, theme, options, direction])

  if (!project) return null
  const procName = project.processes[processId]?.name ?? ''
  const info = FORMATS.find((f) => f.id === format)!
  const printing = format === 'pdf' || format === 'document'

  const doExport = async () => {
    setBusy(true)
    setError(null)
    try {
      await runExport(format, currentRequest(project, processId), { includeQuestions })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog dialog--export"
      onClose={() => useUi.getState().setExportOpen(false)}
      aria-labelledby="export-title"
    >
      {open && (
        <>
          <div className="dialog__head">
            <h2 id="export-title">Vie ja jaa: {procName}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Sulje"
              onClick={() => useUi.getState().setExportOpen(false)}
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="export">
            <div className="export__side">
              <div className="field">
                <span className="field__label">Muoto</span>
                <div className="export__formats" role="radiogroup" aria-label="Vientimuoto">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={format === f.id}
                      className={format === f.id ? 'is-on' : ''}
                      onClick={() => setFormat(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <p className="field__hint">{info.hint}</p>
              </div>
              {format !== 'bpmn' && format !== 'mermaid' && <PresentSettings idPrefix="export" />}
              {(format === 'mermaid' || format === 'bpmn') && (
                <p className="field__hint">
                  {format === 'bpmn'
                    ? 'BPMN-vienti sisältää aina alaprosessit auki ja kaikki vaiheet.'
                    : 'Mermaid-vienti käyttää “Avaa alaprosessit” -asetusta ja suuntaa.'}
                </p>
              )}
              {format === 'document' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeQuestions}
                    onChange={(e) => setIncludeQuestions(e.target.checked)}
                  />
                  Liitä avoimet kysymykset loppuun
                </label>
              )}
            </div>
            <div className="export__preview" aria-label="Esikatselu">
              {error && <p className="issue issue--error">{error}</p>}
              {preview.kind === 'svg' && (
                <div
                  className="export__svg"
                  data-testid="export-preview"
                  // SVG on oma tuotoksemme: kaikki käyttäjän tekstit on escapettu (esc) renderSvg:ssä.
                  dangerouslySetInnerHTML={{ __html: preview.content }}
                />
              )}
              {preview.kind === 'text' && (
                <pre className="export__text" data-testid="export-preview">
                  {preview.content.length > 6000
                    ? `${preview.content.slice(0, 6000)}\n…`
                    : preview.content}
                </pre>
              )}
            </div>
          </div>
          <div className="dialog__actions">
            <button type="button" onClick={() => useUi.getState().setExportOpen(false)}>
              Sulje
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void doExport()}
              data-testid="export-run"
            >
              {busy ? 'Valmistellaan…' : printing ? 'Tulosta / tallenna PDF' : 'Lataa'}
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
