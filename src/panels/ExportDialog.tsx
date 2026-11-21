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
import { DEFAULT_DECK, deckSummary, planDeck, type DeckOptions } from '../export/deck'
import { DEFAULT_TILE_OPTIONS, planTiles, type TileOptions } from '../export/tiles'
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
  const [deck, setDeck] = useState<DeckOptions>(DEFAULT_DECK)
  const [tiles, setTiles] = useState<TileOptions>(DEFAULT_TILE_OPTIONS)
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
        if (format === 'pptx') {
          const slides = await planDeck(project, req, deck)
          if (!cancelled)
            setPreview({
              kind: 'text',
              content: `${slides.length} diaa\n\n${deckSummary(slides).join('\n')}`,
            })
        } else if (IMAGE_FORMATS.includes(format) || format === 'html' || format === 'document') {
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
  }, [open, project, processId, format, theme, options, direction, deck])

  if (!project) return null
  const procName = project.processes[processId]?.name ?? ''
  const info = FORMATS.find((f) => f.id === format)!
  const printing = format === 'pdf' || format === 'document'

  const doExport = async () => {
    setBusy(true)
    setError(null)
    try {
      await runExport(format, currentRequest(project, processId), { includeQuestions, deck, tiles })
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
              {format === 'pdf' && (
                <fieldset className="deck-options" data-testid="print-options">
                  <legend className="field__label">Sivut</legend>
                  <label className="gap-select">
                    <span className="field__label">Sivukoko</span>
                    <select
                      value={tiles.paper}
                      aria-label="Sivukoko"
                      onChange={(e) =>
                        setTiles({ ...tiles, paper: e.target.value as TileOptions['paper'] })
                      }
                    >
                      <option value="fit">Sovita yhdelle sivulle</option>
                      <option value="A4">A4, jaa usealle sivulle</option>
                      <option value="A3">A3, jaa usealle sivulle</option>
                    </select>
                  </label>
                  {tiles.paper !== 'fit' && (
                    <>
                      <label className="gap-select">
                        <span className="field__label">Suunta</span>
                        <select
                          value={tiles.orientation}
                          aria-label="Suunta"
                          onChange={(e) =>
                            setTiles({
                              ...tiles,
                              orientation: e.target.value as TileOptions['orientation'],
                            })
                          }
                        >
                          <option value="landscape">Vaaka</option>
                          <option value="portrait">Pysty</option>
                        </select>
                      </label>
                      <label className="gap-select">
                        <span className="field__label">Mittakaava</span>
                        <select
                          value={tiles.scale}
                          aria-label="Mittakaava"
                          onChange={(e) =>
                            setTiles({ ...tiles, scale: e.target.value as TileOptions['scale'] })
                          }
                        >
                          <option value="width">Sovita leveys yhdelle sivulle</option>
                          <option value="actual">100 %</option>
                        </select>
                      </label>
                      <p className="field__hint" data-testid="tile-estimate">
                        {tileEstimate(preview.kind === 'svg' ? preview.content : '', tiles)}
                      </p>
                    </>
                  )}
                </fieldset>
              )}
              {format === 'pptx' && (
                <fieldset className="deck-options" data-testid="deck-options">
                  <legend className="field__label">Diat</legend>
                  {(
                    [
                      ['overview', 'Prosessin yleiskuva'],
                      ['subprocesses', 'Alaprosessit omina diaoinaan'],
                      ['views', 'Tallennetut näkymät'],
                      ['scenarios', 'Skenaariopolut'],
                      ['metrics', 'Mittarit ja kipupisteet'],
                      ['changes', 'Muutokset lähtötilaan verrattuna'],
                      ['walkthrough', 'Vaihe vaiheelta -läpikäynti'],
                    ] as [keyof DeckOptions, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="check">
                      <input
                        type="checkbox"
                        checked={deck[key]}
                        onChange={(e) => setDeck({ ...deck, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
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

/** Arvio sivumäärästä esikatselukuvan koon perusteella. */
function tileEstimate(svg: string, tiles: TileOptions): string {
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)
  if (!m) return ''
  const plan = planTiles(Number(m[1]), Number(m[2]), tiles)
  if (!plan) return ''
  const total = plan.cols * plan.rows
  return total === 1
    ? 'Kuva mahtuu yhdelle sivulle.'
    : `${total} sivua (${plan.cols} × ${plan.rows}). Sivut voi liittää yhteen isoksi kaavioksi.`
}
