import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { indentLines } from '../capture/indent'
import { diffSummary } from '../capture/summary'
import { cleanAiResponse, looksLikeAiResponse } from '../capture/aiResponse'
import { EXAMPLE_TEXT, SYNTAX_HELP } from '../capture/example'
import { looksLikeMarkdown, markdownToDsl } from '../capture/markdown'
import { planText, type EffectStatus } from '../capture/plan'
import { processToText } from '../capture/serialize'
import { downloadText, safeFilename } from '../export/download'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { AiAssist } from './AiAssist'

const STATUS_LABEL: Record<string, string> = {
  new: 'Uusi',
  matched: 'Löytyi',
  updated: 'Päivitys',
  branch: 'Haara',
  link: 'Yhteys',
  note: 'Huom.',
  renamed: 'Nimi muuttuu',
}

function AddTab() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const text = useUi((s) => s.quickDraft)
  const setText = useUi((s) => s.setQuickDraft)
  const deferred = useDeferredValue(text)
  const [target, setTarget] = useState<'current' | 'new'>('current')
  const [newName, setNewName] = useState('')
  const [standalone, setStandalone] = useState(false)
  const [saveSource, setSaveSource] = useState(true)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [removeMissing, setRemoveMissing] = useState(false)
  /** Poistoehdotukset, jotka käyttäjä haluaa säilyttää. */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  /** Markdown-muunnos: alkuperäinen teksti palautusta varten ja muunnoksen huomautukset. */
  const [mdUndo, setMdUndo] = useState<{
    original: string
    summary: string
    notes: string[]
  } | null>(null)
  /** Kohdistimen paikka, joka asetetaan heti kun React on päivittänyt tekstikentän arvon. */
  const pendingSel = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    if (pendingSel.current && areaRef.current) {
      areaRef.current.setSelectionRange(...pendingSel.current)
      pendingSel.current = null
    }
  }, [text])

  const anchor = selection.nodeIds.length === 1 ? project.nodes[selection.nodeIds[0]] : undefined
  const anchorNode = anchor && anchor.processId === processId ? anchor : undefined

  const plan = useMemo(
    () =>
      planText(project, deferred, {
        processId,
        newProcessName: target === 'new' ? newName : undefined,
        anchorNodeId: anchorNode?.id,
        mode: standalone ? 'standalone' : 'append',
        skipLines: skipped,
        saveSource: false,
        removeMissing,
        keepIds: keep,
      }),
    [
      project,
      deferred,
      processId,
      target,
      newName,
      anchorNode?.id,
      standalone,
      skipped,
      removeMissing,
      keep,
    ],
  )

  // Ohitetut rivit häviävät jäsennetystä tuloksesta, joten rivilista muodostetaan ohittamattomasta suunnitelmasta.
  // Näin ohitetun rivin voi ottaa takaisin mukaan.
  const rowsPlan = useMemo(
    () =>
      skipped.size === 0
        ? plan
        : planText(project, deferred, {
            processId,
            newProcessName: target === 'new' ? newName : undefined,
            anchorNodeId: anchorNode?.id,
            mode: standalone ? 'standalone' : 'append',
            saveSource: false,
            removeMissing,
            keepIds: keep,
          }),
    [
      skipped.size,
      plan,
      project,
      deferred,
      processId,
      target,
      newName,
      anchorNode?.id,
      standalone,
      removeMissing,
      keep,
    ],
  )
  const lines = useMemo(() => deferred.split('\n'), [deferred])
  const isAiResponse = useMemo(() => looksLikeAiResponse(deferred), [deferred])
  const isMarkdown = useMemo(
    () => !isAiResponse && looksLikeMarkdown(deferred),
    [deferred, isAiResponse],
  )
  const cleanResponse = () => {
    const r = cleanAiResponse(text)
    setMdUndo({ original: text, summary: 'tekoälyn vastaus siivottu', notes: r.notes })
    setSkipped(new Set())
    setText(r.text)
  }
  const convertMarkdown = () => {
    const r = markdownToDsl(text)
    setMdUndo({
      original: text,
      summary: `${r.steps} vaihetta ${r.fromDiagram ? 'Mermaid-kaaviosta' : 'otsikoista ja luettelosta'}`,
      notes: r.notes,
    })
    setSkipped(new Set())
    setText(r.dsl)
  }
  // Yksi rivi voi tuottaa useita vaikutuksia (esim. haara ja uusi vaihe): yhdistä ne yhdeksi riviksi.
  const effectRows = useMemo(() => {
    const byLine = new Map<number, EffectStatus[]>()
    for (const e of rowsPlan.effects) {
      const list = byLine.get(e.line) ?? []
      if (!list.includes(e.status)) list.push(e.status)
      byLine.set(e.line, list)
    }
    return [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, statuses]) => ({ line, statuses }))
  }, [rowsPlan.effects])
  const summary = diffSummary(plan.diff)
  const hasContent = plan.parse.items.length > 0 || !!plan.parse.meta
  const blocked = !hasContent || plan.hasErrors

  const apply = () => {
    if (blocked) return
    const result = planText(project, text, {
      processId,
      newProcessName: target === 'new' ? newName : undefined,
      anchorNodeId: anchorNode?.id,
      mode: standalone ? 'standalone' : 'append',
      skipLines: skipped,
      saveSource,
      removeMissing,
      keepIds: keep,
      sourceTitle: `Pikasyöte ${new Date().toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' })}`,
    })
    if (result.hasErrors) return
    if (!useStore.getState().dispatch(result.ops)) return
    if (target === 'new') useStore.getState().setCurrentProcess(result.targetProcessId)
    setText('')
    setSkipped(new Set())
    useUi.getState().closeQuick()
  }

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  const toggleLine = (line: number) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })

  const skippedList = [...skipped].filter((l) => l <= lines.length).sort((a, b) => a - b)

  return (
    <div className="quick">
      <div className="quick__editor">
        <label className="field__label" htmlFor="quick-text">
          Kirjoita tai liitä prosessin kuvaus
        </label>
        <textarea
          id="quick-text"
          ref={areaRef}
          className="quick__textarea"
          spellCheck={false}
          value={text}
          placeholder={EXAMPLE_TEXT}
          aria-describedby="quick-hint"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              apply()
            } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault()
              const el = e.currentTarget
              const r = indentLines(el.value, el.selectionStart, el.selectionEnd, e.shiftKey)
              pendingSel.current = [r.start, r.end]
              setText(r.text)
            }
          }}
        />
        {isAiResponse && (
          <div className="quick__md" role="status" data-testid="ai-response-hint">
            <p>
              Teksti näyttää tekoälyn vastaukselta: mukana on johdantoa, koodilohko tai
              loppuselitys, jotka eivät kuulu prosessiin.
            </p>
            <button type="button" className="btn-primary" onClick={cleanResponse}>
              Siivoa vastaus
            </button>
          </div>
        )}
        {isMarkdown && (
          <div className="quick__md" role="status" data-testid="markdown-hint">
            <p>
              Teksti näyttää Markdown-dokumentilta (otsikoita, taulukoita tai koodilohkoja).
              Pikasyöte tulkitsisi jokaisen rivin erilliseksi vaiheeksi.
            </p>
            <button type="button" className="btn-primary" onClick={convertMarkdown}>
              Muunna vaiheiksi
            </button>
          </div>
        )}
        {mdUndo && !isMarkdown && !isAiResponse && (
          <div className="quick__md" role="status" data-testid="markdown-done">
            <p>Valmis: {mdUndo.summary}. Tarkista tulos ennen lisäämistä.</p>
            {mdUndo.notes.length > 0 && (
              <ul>
                {mdUndo.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                setText(mdUndo.original)
                setMdUndo(null)
              }}
            >
              Palauta alkuperäinen
            </button>
          </div>
        )}
        <p id="quick-hint" className="field__hint">
          Tab sisentää, Shift+Tab vähentää sisennystä (Esc, sitten Tab siirtää kohdistuksen pois).
          Ctrl+Enter lisää.
        </p>
        <AiAssist />

        <fieldset className="quick__options">
          <legend className="field__label">Mihin lisätään</legend>
          <label className="check">
            <input
              type="radio"
              name="target"
              checked={target === 'current'}
              onChange={() => setTarget('current')}
            />
            Nykyiseen prosessiin “{project.processes[processId]?.name}”
          </label>
          {target === 'current' && (
            <div className="quick__sub">
              <p className="field__hint">
                {standalone
                  ? 'Sisältö jää irralliseksi.'
                  : anchorNode
                    ? `Liitetään vaiheen “${anchorNode.label}” jälkeen.`
                    : 'Liitetään prosessin loppuun (valitse kaaviosta vaihe, jos haluat liittää muualle).'}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={standalone}
                  onChange={(e) => setStandalone(e.target.checked)}
                />
                Älä liitä olemassa olevaan
              </label>
              {!standalone && !anchorNode && (
                <label className="check">
                  <input
                    type="checkbox"
                    data-testid="remove-missing"
                    checked={removeMissing}
                    onChange={(e) => {
                      setRemoveMissing(e.target.checked)
                      setKeep(new Set())
                    }}
                  />
                  Poista vaiheet, joita tekstissä ei ole (teksti kuvaa koko prosessin)
                </label>
              )}
            </div>
          )}
          <label className="check">
            <input
              type="radio"
              name="target"
              checked={target === 'new'}
              onChange={() => setTarget('new')}
            />
            Uuteen prosessiin
          </label>
          {target === 'new' && (
            <div className="quick__sub">
              <input
                aria-label="Uuden prosessin nimi"
                placeholder={plan.parse.title ?? 'Prosessin nimi (tai otsikkorivi # Nimi)'}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={saveSource}
              onChange={(e) => setSaveSource(e.target.checked)}
            />
            Tallenna teksti lähteeksi (vaiheista pääsee takaisin alkuperäiseen tekstiin)
          </label>
        </fieldset>
      </div>

      <div className="quick__preview" aria-live="polite">
        <h3 className="panel__title quick__title">Esikatselu</h3>
        {!hasContent ? (
          <p className="muted">
            Kirjoita tai liitä teksti vasemmalle, niin näet tässä mitä malliin tulee.
          </p>
        ) : (
          <>
            <p className="quick__summary" data-testid="quick-summary">
              {summary || 'Ei muutoksia: teksti vastaa jo olemassa olevaa prosessia.'}
            </p>
            {plan.issues.length > 0 && (
              <ul className="issues" aria-label="Huomautukset">
                {plan.issues.map((i, idx) => (
                  <li key={idx} className={`issue issue--${i.severity}`}>
                    <Icon name="warn" size={14} />
                    <span>
                      <b>Rivi {i.line}:</b> {i.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="effects" aria-label="Rivit ja niiden vaikutus">
              {effectRows.map((row) => (
                <li key={row.line} className={skipped.has(row.line) ? 'is-skipped' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!skipped.has(row.line)}
                      onChange={() => toggleLine(row.line)}
                      aria-label={`Ota mukaan rivi ${row.line}`}
                    />
                    <span className="effects__line">{row.line}</span>
                    <code>{(lines[row.line - 1] ?? '').trim()}</code>
                    {row.statuses.map((st) => (
                      <span key={st} className={`badge badge--${st}`}>
                        {STATUS_LABEL[st]}
                      </span>
                    ))}
                  </label>
                </li>
              ))}
            </ul>
            {plan.removals.length > 0 && (
              <>
                <h4 className="quick__removals-title">Poistuu mallista</h4>
                <ul className="effects effects--removals" data-testid="quick-removals">
                  {plan.removals.map((r) => (
                    <li key={r.id} className={keep.has(r.id) ? 'is-skipped' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!keep.has(r.id)}
                          aria-label={`Poista ${r.label}`}
                          onChange={() =>
                            setKeep((prev) => {
                              const next = new Set(prev)
                              if (next.has(r.id)) next.delete(r.id)
                              else next.add(r.id)
                              return next
                            })
                          }
                        />
                        <code>{r.label}</code>
                        <span className="badge badge--removed">Poistuu</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {skippedList.length > 0 && (
              <p className="field__hint">Ohitetut rivit: {skippedList.join(', ')}</p>
            )}
          </>
        )}
      </div>

      <div className="quick__footer">
        <details className="quick__help">
          <summary>Syntaksiohje</summary>
          <table>
            <tbody>
              {SYNTAX_HELP.map((h) => (
                <tr key={h.syntax}>
                  <th scope="row">
                    <code>{h.syntax}</code>
                  </th>
                  <td>{h.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setText(EXAMPLE_TEXT)}>
            Lisää esimerkki
          </button>
        </details>
        <div className="dialog__actions">
          <button type="button" onClick={() => useUi.getState().closeQuick()}>
            Sulje
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={blocked}
            onClick={apply}
            data-testid="quick-apply"
          >
            Lisää malliin
          </button>
        </div>
      </div>
    </div>
  )
}

function ExportTab() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const [copied, setCopied] = useState(false)
  const text = useMemo(
    () => processToText(project, processId, { title: true }),
    [project, processId],
  )
  const name = project.processes[processId]?.name ?? 'prosessi'

  return (
    <div className="quick quick--export">
      <div className="quick__editor">
        <label className="field__label" htmlFor="export-text">
          Prosessi “{name}” tekstinä
        </label>
        <textarea
          id="export-text"
          className="quick__textarea"
          readOnly
          value={text}
          onFocus={(e) => e.target.select()}
        />
        <p className="field__hint">
          Tekstin voi muokata ja lisätä takaisin: samannimiset vaiheet tunnistetaan, joten mitään ei
          tule kahteen kertaan.
        </p>
      </div>
      <div className="quick__footer">
        <div className="dialog__actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              } catch {
                useStore
                  .getState()
                  .setError('Kopiointi ei onnistunut. Valitse teksti ja kopioi käsin.')
              }
            }}
          >
            <Icon name="copy" size={16} /> {copied ? 'Kopioitu' : 'Kopioi'}
          </button>
          <button
            type="button"
            onClick={() => downloadText(text + '\n', `${safeFilename(name)}.txt`)}
          >
            <Icon name="download" size={16} /> Lataa .txt
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => useUi.getState().openQuick('add', text)}
          >
            <Icon name="edit" size={16} /> Muokkaa tästä
          </button>
        </div>
      </div>
    </div>
  )
}

export function QuickInput() {
  const open = useUi((s) => s.quickOpen)
  const tab = useUi((s) => s.quickTab)
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
      className="dialog dialog--quick"
      onClose={() => useUi.getState().closeQuick()}
      aria-labelledby="quick-title"
    >
      {open && (
        <>
          <div className="dialog__head">
            <h2 id="quick-title">Pikasyöte</h2>
            <div className="tabs tabs--inline" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'add'}
                className={tab === 'add' ? 'is-on' : ''}
                onClick={() => useUi.getState().openQuick('add')}
              >
                Lisää tekstistä
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'export'}
                className={tab === 'export' ? 'is-on' : ''}
                onClick={() => useUi.getState().openQuick('export')}
              >
                Vie tekstinä
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Sulje"
              onClick={() => useUi.getState().closeQuick()}
            >
              <Icon name="x" />
            </button>
          </div>
          {tab === 'add' ? <AddTab /> : <ExportTab />}
        </>
      )}
    </dialog>
  )
}
