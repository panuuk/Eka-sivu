import { useEffect, useMemo, useRef, useState } from 'react'
import { BpmnImportError, parseBpmn } from '../capture/bpmnImport'
import { graphToOps, graphToProject, summarize, type ImportedGraph } from '../capture/diagram'
import { MermaidImportError, parseMermaid } from '../capture/mermaidImport'
import { MAX_FILE_BYTES } from '../capture/importers'
import {
  decodeTextBytes,
  detectMapping,
  FIELD_LABELS,
  looksLikeHeader,
  parseDelimited,
  parseXlsx,
  tableToDsl,
  type Field,
  type Mapping,
  type Table,
} from '../capture/table'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'

type Tab = 'table' | 'diagram'
const MAX_ROWS = 5000
const FIELDS = Object.keys(FIELD_LABELS) as Field[]

/** Tuo taulukon (Excel, CSV, leikepöytä) tai kaavion (BPMN, Mermaid) olemassa olevasta materiaalista. */
export function ImportDialog() {
  const open = useUi((s) => s.importOpen)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide dialog--import"
      onClose={() => useUi.getState().setImportOpen(false)}
      aria-labelledby="import-title"
    >
      {open && <Body />}
    </dialog>
  )
}

function Body() {
  const [tab, setTab] = useState<Tab>('table')
  const close = () => useUi.getState().setImportOpen(false)
  return (
    <>
      <div className="dialog__head">
        <h2 id="import-title">Tuo materiaalia</h2>
        <button type="button" className="icon-btn" aria-label="Sulje" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="segmented segmented--compact" role="radiogroup" aria-label="Tuotavan tyyppi">
        {(
          [
            ['table', 'Taulukko (Excel, CSV)'],
            ['diagram', 'Kaavio (BPMN, Mermaid)'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tab === t}
            className={tab === t ? 'is-on' : ''}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'table' ? <TableTab close={close} /> : <DiagramTab close={close} />}
    </>
  )
}

function TableTab({ close }: { close: () => void }) {
  const [sheets, setSheets] = useState<{ name: string; rows: Table }[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Mapping>({})
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [name, setName] = useState('')

  const rows = sheets[sheetIdx]?.rows ?? []
  const header = hasHeader ? (rows[0] ?? []) : []
  const data = hasHeader ? rows.slice(1) : rows
  const width = rows[0]?.length ?? 0

  const load = (list: { name: string; rows: Table }[], label: string) => {
    const first = list.find((s) => s.rows.length > 0)
    if (!first) return setError('Taulukossa ei ole rivejä')
    if (first.rows.length > MAX_ROWS)
      return setError(`Taulukossa on liikaa rivejä (enintään ${MAX_ROWS})`)
    const idx = list.indexOf(first)
    const head = looksLikeHeader(first.rows[0])
    setSheets(list)
    setSheetIdx(idx)
    setHasHeader(head)
    setMapping(head ? detectMapping(first.rows[0]) : { step: 0 })
    setName(label)
    setError(null)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Tiedosto on liian suuri')
      const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase()
      if (ext === 'xlsx' || ext === 'xlsm') {
        load((await parseXlsx(await file.arrayBuffer())).sheets, file.name)
      } else if (ext === 'xls') {
        throw new Error('Vanha .xls-muoto ei ole tuettu. Tallenna tiedosto muodossa .xlsx tai CSV.')
      } else {
        const text = decodeTextBytes(new Uint8Array(await file.arrayBuffer()))
        load([{ name: file.name, rows: parseDelimited(text) }], file.name)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const changeSheet = (i: number) => {
    setSheetIdx(i)
    const r = sheets[i].rows
    const head = r.length > 0 && looksLikeHeader(r[0])
    setHasHeader(head)
    setMapping(head ? detectMapping(r[0]) : { step: 0 })
  }

  const toggleHeader = (on: boolean) => {
    setHasHeader(on)
    setMapping(on && rows[0] ? detectMapping(rows[0]) : { step: 0 })
  }

  const setField = (col: number, field: Field | '') => {
    setMapping((m) => {
      const next: Mapping = {}
      for (const [k, v] of Object.entries(m)) if (v !== col && k !== field) next[k as Field] = v
      if (field) next[field] = col
      return next
    })
  }
  const fieldOf = (col: number): Field | '' =>
    (FIELDS.find((f) => mapping[f] === col) as Field | undefined) ?? ''

  const result = useMemo(() => tableToDsl(data, mapping), [data, mapping])

  return (
    <div className="import__body" data-testid="import-table">
      <p className="field__hint">
        Valitse Excel- tai CSV-tiedosto tai liitä taulukko (esim. kopioitu Excelistä). Sarakkeet
        yhdistetään vaiheen kenttiin ja tulos avataan pikasyötteessä, jossa näet muutokset ennen
        lisäämistä. Rivien järjestys on prosessin kulku.
      </p>
      <div className="storage__actions">
        <label className="btn-like">
          <input
            type="file"
            hidden
            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
            data-testid="import-table-file"
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Icon name="upload" size={16} /> Valitse tiedosto…
        </label>
        {sheets.length > 1 && (
          <label>
            Taulukko{' '}
            <select
              aria-label="Taulukkovälilehti"
              value={sheetIdx}
              onChange={(e) => changeSheet(Number(e.target.value))}
            >
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span className="field__label">Tai liitä taulukko tähän</span>
        <textarea
          rows={3}
          value={paste}
          data-testid="import-table-paste"
          placeholder={'Vaihe\tRooli\tJärjestelmä\nTarkista lasku\tTalous\tERP'}
          onChange={(e) => {
            setPaste(e.target.value)
            if (e.target.value.trim())
              load(
                [{ name: 'Liitetty taulukko', rows: parseDelimited(e.target.value) }],
                'Liitetty taulukko',
              )
          }}
        />
      </label>
      {error && <p className="issue issue--error">{error}</p>}

      {rows.length > 0 && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => toggleHeader(e.target.checked)}
            />
            Ensimmäinen rivi on otsikkorivi
          </label>
          <div className="matrix-wrap">
            <table className="matrix import__preview" data-testid="import-preview-table">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, c) => (
                    <th key={c} scope="col">
                      <select
                        aria-label={`Sarake ${c + 1}${header[c] ? ` (${header[c]})` : ''}`}
                        value={fieldOf(c)}
                        onChange={(e) => setField(c, e.target.value as Field | '')}
                      >
                        <option value="">Ei käytetä</option>
                        {FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </option>
                        ))}
                      </select>
                      {hasHeader && <div className="muted">{header[c]}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field__hint">
            {data.length} riviä{data.length > 6 ? ', näytetään 6' : ''}. Tuloksena {result.steps}{' '}
            vaihetta.
          </p>
          {result.warnings.length > 0 && (
            <ul className="issue-list" data-testid="import-warnings">
              {result.warnings.slice(0, 6).map((w) => (
                <li key={w} className="issue issue--warning">
                  {w}
                </li>
              ))}
              {result.warnings.length > 6 && (
                <li className="muted">… ja {result.warnings.length - 6} muuta</li>
              )}
            </ul>
          )}
          <pre className="import__dsl" data-testid="import-dsl" aria-label="Pikasyöte-teksti">
            {result.text.split('\n').slice(0, 12).join('\n')}
            {result.text.split('\n').length > 12 ? '\n…' : ''}
          </pre>
        </>
      )}
      <div className="dialog__actions">
        <button type="button" onClick={close}>
          Peruuta
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={result.steps === 0}
          data-testid="import-table-apply"
          onClick={() => {
            useUi.getState().openQuick('add', `${name ? `// Tuotu: ${name}\n` : ''}${result.text}`)
            close()
          }}
        >
          Avaa pikasyötteessä
        </button>
      </div>
    </div>
  )
}

function DiagramTab({ close }: { close: () => void }) {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const [graph, setGraph] = useState<ImportedGraph | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [dest, setDest] = useState<'new' | 'here'>('new')

  const parse = (text: string, label: string) => {
    try {
      const t = text.trim()
      const g = t.startsWith('<') ? parseBpmn(t) : parseMermaid(t)
      setGraph(g)
      setFileName(label)
      setError(null)
    } catch (e) {
      setGraph(null)
      setError(
        e instanceof BpmnImportError || e instanceof MermaidImportError
          ? e.message
          : `Kaavion lukeminen epäonnistui: ${(e as Error).message}`,
      )
    }
  }

  const summary = graph ? summarize(graph) : null

  const apply = async () => {
    if (!graph) return
    if (dest === 'new') {
      const name = graph.processes[0]?.name || fileName.replace(/\.[^.]+$/, '') || 'Tuotu kaavio'
      await useStore.getState().adoptProject(graphToProject(graph, name))
    } else {
      useStore.getState().dispatch(graphToOps(project, graph, processId))
    }
    close()
  }

  return (
    <div className="import__body" data-testid="import-diagram">
      <p className="field__hint">
        Tuo BPMN 2.0 -tiedosto (.bpmn tai .xml, esim. Signavio, Camunda, bpmn.io) tai
        Mermaid-vuokaavio. Rakenne, uimaradat (rooleiksi) ja alaprosessit tulevat mukaan. Asettelu
        lasketaan uudelleen.
      </p>
      <div className="storage__actions">
        <label className="btn-like">
          <input
            type="file"
            hidden
            accept=".bpmn,.xml,.mmd,.mermaid,.md,.txt"
            data-testid="import-diagram-file"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (f.size > MAX_FILE_BYTES) return setError('Tiedosto on liian suuri')
              parse(await f.text(), f.name)
            }}
          />
          <Icon name="upload" size={16} /> Valitse tiedosto…
        </label>
      </div>
      <label className="field">
        <span className="field__label">Tai liitä Mermaid-koodi tai BPMN-XML</span>
        <textarea
          rows={4}
          value={paste}
          data-testid="import-diagram-paste"
          placeholder={'flowchart TD\n  A[Vastaanota] --> B{Kunnossa?}'}
          onChange={(e) => {
            setPaste(e.target.value)
            if (e.target.value.trim()) parse(e.target.value, 'Liitetty kaavio')
          }}
        />
      </label>
      {error && <p className="issue issue--error">{error}</p>}
      {summary && graph && (
        <div className="import__summary" data-testid="import-summary">
          <strong>{fileName}</strong>: {summary.steps} vaihetta, {summary.decisions} päätöstä,{' '}
          {summary.subprocesses} alaprosessia, {summary.roles} roolia ja {summary.edges} yhteyttä
          {graph.processes.length > 1
            ? `. ${graph.processes.length} prosessia tuodaan alaprosesseina.`
            : '.'}
          {graph.skipped.length > 0 && (
            <div className="muted">Ei tuotu: {graph.skipped.join(', ')}.</div>
          )}
          <div className="import__dest" role="radiogroup" aria-label="Minne tuodaan">
            <label className="check">
              <input
                type="radio"
                name="dest"
                checked={dest === 'new'}
                onChange={() => setDest('new')}
              />
              Uutena projektina
            </label>
            <label className="check">
              <input
                type="radio"
                name="dest"
                checked={dest === 'here'}
                onChange={() => setDest('here')}
              />
              Lisää nykyiseen prosessiin “{project.processes[processId]?.name}” (kumottavissa)
            </label>
          </div>
        </div>
      )}
      <div className="dialog__actions">
        <button type="button" onClick={close}>
          Peruuta
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!graph}
          onClick={() => void apply()}
          data-testid="import-diagram-apply"
        >
          Tuo kaavio
        </button>
      </div>
    </div>
  )
}
