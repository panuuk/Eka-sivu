import { useEffect, useMemo, useRef, useState } from 'react'
import type { Source } from '../model/types'
import { findMentions } from '../capture/mentions'
import { importFile, SUPPORTED_EXTENSIONS } from '../capture/importers'
import { refsOfSource } from '../capture/refs'
import type { Mark } from '../capture/segments'
import { discoverEntities, type Candidate } from '../capture/discover'
import { ensureEntity } from '../model/commands'
import type { Operation } from '../model/operations'
import { ruleExtractor, type Suggestion } from '../capture/suggest'
import { resolveAnchor } from '../store/actions'
import {
  acceptSuggestion,
  acceptSuggestions,
  addEntityFromText,
  addNodeFromRange,
  attachRangeToNode,
  createSource,
  labelFromQuote,
  removeRef,
  updateSourceText,
} from '../store/sourceActions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { Menu } from '../ui/Menu'
import { SourceReader } from './SourceReader'

type Tab = 'selection' | 'suggestions' | 'refs'
interface Range {
  start: number
  end: number
}

/** Näytettävien ehdotusten ja tunnistettujen mainintojen enimmäismäärä, jotta valtavat dokumentit pysyvät sujuvina. */
const MAX_SUGGESTIONS = 150
const MAX_MENTION_MARKS = 4000

const ACCEPT = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',')

/** Tiedostotuonti ja muistiinpanon luonti, jaettu tyhjän tilan ja työnäkymän kesken. */
function useSourceCreation() {
  const [busy, setBusy] = useState(false)
  const importFiles = async (files: FileList | File[]) => {
    setBusy(true)
    const errors: string[] = []
    for (const file of Array.from(files)) {
      try {
        const doc = await importFile(file)
        createSource({ title: doc.title, text: doc.text, kind: 'document', fileName: doc.fileName })
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    if (errors.length) useStore.getState().setError(errors.join(' | '))
  }
  const newNote = async () => {
    const title = await useUi.getState().prompt({
      title: 'Uusi muistiinpano',
      label: 'Otsikko',
      initial: 'Muistiinpano',
      confirmLabel: 'Luo',
    })
    if (!title) return
    const id = createSource({ title, text: '', kind: 'note' })
    if (id) useUi.getState().setPendingEditSource(id)
  }
  return { busy, importFiles, newNote }
}

function FileInput({ onFiles }: { onFiles: (files: FileList) => void }) {
  return (
    <input
      id="source-file-input"
      type="file"
      multiple
      accept={ACCEPT}
      hidden
      data-testid="source-file-input"
      onChange={(e) => {
        if (e.target.files) onFiles(e.target.files)
        e.target.value = ''
      }}
    />
  )
}

export function SourcesView() {
  const project = useStore((s) => s.project)!
  const openId = useUi((s) => s.openSourceId)
  const { busy, importFiles, newNote } = useSourceCreation()
  const [dragging, setDragging] = useState(false)

  const sources = useMemo(
    () => Object.values(project.sources).sort((a, b) => a.addedAt - b.addedAt),
    [project.sources],
  )
  const source = (openId && project.sources[openId]) || sources[0]

  // Pidä avoin lähde voimassa (esim. kun avoin lähde poistetaan)
  useEffect(() => {
    if (source && source.id !== openId) useUi.getState().setOpenSource(source.id)
  }, [source, openId])

  if (!source) {
    return (
      <div
        className={`sources-empty ${dragging ? 'is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files)
        }}
      >
        <div className="canvas__empty canvas__empty--static">
          <h2>Ei vielä lähteitä</h2>
          <p>
            Tuo dokumentteja tai kirjoita muistiinpanoja. Voit sitten poimia tekstistä vaiheita,
            päätöksiä, rooleja ja järjestelmiä, ja jokainen poiminta muistaa mistä kohdasta se on
            peräisin.
          </p>
          <div className="canvas__empty-actions">
            <label className="btn-primary btn-like" htmlFor="source-file-input">
              <Icon name="upload" size={16} /> {busy ? 'Tuodaan…' : 'Tuo tiedosto'}
            </label>
            <button type="button" onClick={() => void newNote()}>
              Kirjoita muistiinpano
            </button>
          </div>
          <p className="field__hint">
            Tuetut tiedostot: Word (.docx), PDF, tekstitiedostot (.txt, .md). Voit myös vetää
            tiedoston tähän.
          </p>
        </div>
        <FileInput onFiles={(f) => void importFiles(f)} />
      </div>
    )
  }

  return <SourceWorkspace key={source.id} source={source} sources={sources} />
}

function SourceWorkspace({ source, sources }: { source: Source; sources: Source[] }) {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const focusRef = useUi((s) => s.focusRef)
  const tab = useUi((s) => s.sourcesTab)
  const flash = useUi((s) => s.flash)
  const setTab = useUi((s) => s.setSourcesTab)
  const readerWrap = useRef<HTMLDivElement>(null)
  const { busy, importFiles, newNote } = useSourceCreation()

  const [range, setRange] = useState<Range | null>(null)
  // Uusi muistiinpano aukeaa suoraan muokattavaksi.
  const [editing, setEditing] = useState(() => useUi.getState().pendingEditSourceId === source.id)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showWeak, setShowWeak] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<{ id: string; label: string } | null>(null)
  const [nameOverride, setNameOverride] = useState<{ quote: string; value: string } | null>(null)

  useEffect(() => {
    if (useUi.getState().pendingEditSourceId === source.id)
      useUi.getState().setPendingEditSource(null)
  }, [source.id])

  const quote = range ? source.text.slice(range.start, range.end) : ''
  const nameDraft =
    nameOverride && nameOverride.quote === quote
      ? nameOverride.value
      : quote
        ? labelFromQuote(quote)
        : ''

  // Vieritä kohtaan, jota esim. solmun lähdeviite osoittaa
  useEffect(() => {
    if (!focusRef || focusRef.sourceId !== source.id) return
    requestAnimationFrame(() => scrollToOffset(readerWrap.current, focusRef.start))
  }, [focusRef, source.id])

  const refs = useMemo(() => refsOfSource(project, source.id), [project, source.id])
  // Tunnistus ja ehdotukset riippuvat vain entiteeteistä, ei koko projektista.
  const entityScope = useMemo(() => ({ entities: project.entities }), [project.entities])
  const mentions = useMemo(() => findMentions(entityScope, source.text), [entityScope, source.text])
  const allSuggestions = useMemo(
    () => ruleExtractor.suggest(entityScope, source.id, source.text),
    [entityScope, source.text, source.id],
  )
  const candidates = useMemo(
    () => discoverEntities(entityScope, source.text),
    [entityScope, source.text],
  )
  const allMatching = useMemo(() => {
    const covered = (s: Suggestion) =>
      refs.some(
        (r) =>
          !r.stale &&
          Math.min(r.ref.end, s.end) - Math.max(r.ref.start, s.start) >= (s.end - s.start) * 0.5,
      )
    return allSuggestions.filter(
      (s) =>
        !dismissed.has(`${s.start}-${s.end}`) &&
        !covered(s) &&
        (showWeak ? s.score >= 1 : s.score >= 2),
    )
  }, [allSuggestions, refs, dismissed, showWeak])
  const suggestions = useMemo(() => allMatching.slice(0, MAX_SUGGESTIONS), [allMatching])

  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = []
    for (const r of refs)
      if (!r.stale)
        out.push({ type: 'ref', start: r.ref.start, end: r.ref.end, nodeIds: [r.node.id] })
    for (const m of mentions.slice(0, MAX_MENTION_MARKS))
      out.push({
        type: m.kind === 'role' ? 'role' : m.kind === 'system' ? 'system' : 'artifact',
        start: m.start,
        end: m.end,
      })
    if (tab === 'suggestions')
      for (const s of suggestions)
        out.push({ type: 'suggestion', start: s.start, end: s.end, suggestionId: s.id })
    if (range) out.push({ type: 'selection', start: range.start, end: range.end })
    if (flash) out.push({ type: 'focus', start: flash.start, end: flash.end })
    return out
  }, [refs, mentions, suggestions, range, flash, tab])

  const showRange = (start: number, end: number) => {
    useUi.getState().flashRange(start, end)
    scrollToOffset(readerWrap.current, start)
  }

  const selectedNode =
    selection.nodeIds.length === 1 ? project.nodes[selection.nodeIds[0]] : undefined
  const anchorId = resolveAnchor(project, processId, selection)
  const anchorLabel = anchorId ? project.nodes[anchorId]?.label : undefined
  const selMentions = range ? findMentions(project, quote, ['role', 'system']) : []
  const processName = project.processes[processId]?.name

  const doCreate = (kind: 'step' | 'decision') => {
    if (!range) return
    const id = addNodeFromRange({ sourceId: source.id, ...range }, kind, nameDraft)
    if (id) {
      setAdded({ id, label: project.nodes[id]?.label ?? nameDraft })
      setRange(null)
      window.getSelection()?.removeAllRanges()
    }
  }

  return (
    <div className="sources" data-testid="sources-view">
      <div className="sources__bar">
        <label className="sr-only" htmlFor="source-select">
          Lähde
        </label>
        <select
          id="source-select"
          value={source.id}
          onChange={(e) => useUi.getState().setOpenSource(e.target.value)}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'document' ? '📄' : '📝'} {s.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void newNote()}>
          <Icon name="plus" size={16} /> Muistiinpano
        </button>
        <label className="btn-like" htmlFor="source-file-input">
          <Icon name="upload" size={16} /> {busy ? 'Tuodaan…' : 'Tuo tiedosto'}
        </label>
        <FileInput onFiles={(f) => void importFiles(f)} />
        <span className="sources__spacer" />
        {editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)}>
              Peruuta
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                updateSourceText(source.id, draft)
                setEditing(false)
                setRange(null)
              }}
            >
              <Icon name="check" size={16} /> Valmis
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(source.text)
              setEditing(true)
            }}
          >
            <Icon name="edit" size={16} /> Muokkaa tekstiä
          </button>
        )}
        <Menu
          label="Lähteen toiminnot"
          triggerClassName="icon-btn"
          trigger={<Icon name="dots" size={16} />}
          align="right"
          items={[
            {
              label: 'Nimeä uudelleen…',
              onSelect: async () => {
                const title = await useUi.getState().prompt({
                  title: 'Nimeä lähde',
                  label: 'Otsikko',
                  initial: source.title,
                  confirmLabel: 'Tallenna',
                })
                if (title)
                  useStore
                    .getState()
                    .dispatch({ type: 'updateSource', id: source.id, patch: { title } })
              },
            },
            {
              label: 'Poista lähde…',
              danger: true,
              separatorBefore: true,
              onSelect: async () => {
                const ok = await useUi.getState().ask({
                  title: `Poistetaanko “${source.title}”?`,
                  message: `Lähde poistetaan. ${refs.length} vaiheiden lähdeviitettä poistuu, mutta itse vaiheet säilyvät.`,
                  confirmLabel: 'Poista',
                  danger: true,
                })
                if (ok) {
                  useStore.getState().dispatch({ type: 'deleteSource', id: source.id })
                  useUi.getState().setOpenSource(null)
                }
              },
            },
          ]}
        />
      </div>

      <div className="sources__body">
        <div
          className={`sources__reader ${dragging ? 'is-drag' : ''}`}
          ref={readerWrap}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDragging(true)
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return
            e.preventDefault()
            setDragging(false)
            void importFiles(e.dataTransfer.files)
          }}
        >
          {editing ? (
            <textarea
              className="reader reader--edit"
              aria-label="Lähdetekstin muokkaus"
              value={draft}
              autoFocus
              placeholder="Kirjoita tai liitä teksti tähän"
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : source.text ? (
            <SourceReader
              text={source.text}
              marks={marks}
              onSelect={(r) => {
                setRange(r)
                if (r) setTab('selection')
              }}
              onClickNodes={(ids) => {
                useStore.getState().select({ nodeIds: ids.slice(0, 1), edgeIds: [] })
                const n = project.nodes[ids[0]]
                if (n && n.processId !== processId)
                  useStore.getState().setCurrentProcess(n.processId)
                useStore.getState().select({ nodeIds: ids.slice(0, 1), edgeIds: [] })
              }}
              onClickSuggestion={(id) => {
                setTab('suggestions')
                document.getElementById(`sug-${id}`)?.scrollIntoView({ block: 'nearest' })
              }}
            />
          ) : (
            <p className="muted reader__empty">
              Lähde on tyhjä. Valitse “Muokkaa tekstiä” ja liitä tai kirjoita teksti.
            </p>
          )}
        </div>

        <aside className="sources__side" aria-label="Poiminta">
          <div className="tabs tabs--compact" role="tablist">
            {(
              [
                ['selection', 'Valinta'],
                [
                  'suggestions',
                  `Ehdotukset${suggestions.length ? ` (${suggestions.length})` : ''}`,
                ],
                ['refs', `Viitteet${refs.length ? ` (${refs.length})` : ''}`],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'is-on' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="sources__target field__hint">
            Lisätään prosessiin <b>{processName}</b>
            {anchorLabel ? (
              <>
                {' '}
                vaiheen <b>{anchorLabel}</b> jälkeen
              </>
            ) : (
              ' loppuun'
            )}
            .
          </p>

          {added && (
            <p className="sources__added" role="status">
              <Icon name="check" size={14} /> Lisätty: <b>{added.label}</b>{' '}
              <button
                type="button"
                className="linklike"
                onClick={() => useUi.getState().setView('canvas')}
              >
                Näytä kaaviossa
              </button>
            </p>
          )}

          {tab === 'selection' && (
            <div className="side-section">
              {!range ? (
                <>
                  <p className="muted">
                    Valitse tekstistä kohta, niin voit luoda siitä vaiheen tai päätöksen, tai
                    liittää sen olemassa olevaan vaiheeseen.
                  </p>
                  <Legend />
                </>
              ) : (
                <>
                  <blockquote className="sel-quote">
                    {quote.length > 280 ? `${quote.slice(0, 280)}…` : quote}
                  </blockquote>
                  <div className="field">
                    <label className="field__label" htmlFor="sel-name">
                      Nimi
                    </label>
                    <input
                      id="sel-name"
                      value={nameDraft}
                      onChange={(e) => setNameOverride({ quote, value: e.target.value })}
                    />
                  </div>
                  {selMentions.length > 0 && (
                    <p className="field__hint">
                      Tunnistettu:{' '}
                      {[...new Set(selMentions.map((m) => project.entities[m.entityId].name))].join(
                        ', ',
                      )}
                    </p>
                  )}
                  <div className="side-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => doCreate('step')}
                      disabled={!nameDraft.trim()}
                    >
                      Luo vaihe
                    </button>
                    <button
                      type="button"
                      onClick={() => doCreate('decision')}
                      disabled={!nameDraft.trim()}
                    >
                      Luo päätös
                    </button>
                    <button
                      type="button"
                      disabled={!selectedNode}
                      title={
                        selectedNode ? undefined : 'Valitse ensin vaihe kaaviosta tai listasta'
                      }
                      onClick={() =>
                        selectedNode &&
                        attachRangeToNode({ sourceId: source.id, ...range }, selectedNode.id)
                      }
                    >
                      Liitä viitteeksi{selectedNode ? `: ${selectedNode.label}` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => addEntityFromText('role', nameDraft, selectedNode?.id)}
                      disabled={!nameDraft.trim()}
                    >
                      Rooliksi
                    </button>
                    <button
                      type="button"
                      onClick={() => addEntityFromText('system', nameDraft, selectedNode?.id)}
                      disabled={!nameDraft.trim()}
                    >
                      Järjestelmäksi
                    </button>
                  </div>
                  <p className="field__hint">
                    Rooli ja järjestelmä liitetään valittuun vaiheeseen, jos sellainen on valittuna.
                  </p>
                </>
              )}
            </div>
          )}

          {tab === 'suggestions' && (
            <div className="side-section">
              {candidates.length > 0 && <CandidatePanel candidates={candidates} />}
              <div className="side-actions side-actions--row">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={suggestions.length === 0}
                  onClick={() => acceptSuggestions(suggestions, source.id)}
                >
                  Lisää kaikki ({suggestions.length})
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showWeak}
                    onChange={(e) => setShowWeak(e.target.checked)}
                  />
                  Näytä heikommat
                </label>
              </div>
              {suggestions.length === 0 ? (
                <p className="muted">
                  {allSuggestions.length === 0
                    ? 'Tekstistä ei löytynyt ehdotuksia. Valitse tekstistä kohtia käsin.'
                    : 'Ei uusia ehdotuksia. Kaikki on jo lisätty, ohitettu tai heikkoja.'}
                </p>
              ) : (
                <>
                  {allMatching.length > suggestions.length && (
                    <p className="field__hint">
                      Näytetään {suggestions.length} ensimmäistä ehdotusta ({allMatching.length}{' '}
                      yhteensä). Lisää tai ohita ne, niin seuraavat tulevat näkyviin.
                    </p>
                  )}
                  <ul className="suggestions">
                    {suggestions.map((s) => (
                      <li
                        key={s.id}
                        id={`sug-${s.id}`}
                        className={`suggestion suggestion--${s.kind}`}
                      >
                        <button
                          type="button"
                          className="suggestion__text"
                          onClick={() => {
                            showRange(s.start, s.end)
                          }}
                          title="Näytä tekstissä"
                        >
                          <span className="suggestion__kind">
                            {s.kind === 'decision'
                              ? 'Päätös'
                              : s.branch === 'yes'
                                ? 'Kyllä-haara'
                                : s.branch === 'no'
                                  ? 'Ei-haara'
                                  : 'Vaihe'}
                          </span>
                          {s.label}
                        </button>
                        <p className="suggestion__why">
                          {s.reasons.join(' · ')}
                          {s.roleId ? '' : ''}
                        </p>
                        <div className="suggestion__actions">
                          <button type="button" onClick={() => acceptSuggestion(s, source.id)}>
                            Lisää
                          </button>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() =>
                              setDismissed((d) => new Set(d).add(`${s.start}-${s.end}`))
                            }
                          >
                            Ohita
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Legend />
            </div>
          )}

          {tab === 'refs' && (
            <div className="side-section">
              {refs.length === 0 ? (
                <p className="muted">Mikään vaihe ei viittaa tähän lähteeseen vielä.</p>
              ) : (
                <ul className="ref-list">
                  {refs.map((r, i) => (
                    <li key={`${r.node.id}-${i}`} className={r.stale ? 'is-stale' : ''}>
                      <button
                        type="button"
                        className="ref-list__node"
                        onClick={() => {
                          useStore.getState().select({ nodeIds: [r.node.id], edgeIds: [] })
                          if (r.node.processId !== processId)
                            useStore.getState().setCurrentProcess(r.node.processId)
                          useStore.getState().select({ nodeIds: [r.node.id], edgeIds: [] })
                          if (!r.stale) showRange(r.ref.start, r.ref.end)
                        }}
                      >
                        {r.node.label}
                      </button>
                      <q>
                        {r.ref.quote.length > 120 ? `${r.ref.quote.slice(0, 120)}…` : r.ref.quote}
                      </q>
                      {r.stale && (
                        <p className="ref-list__stale">
                          <Icon name="warn" size={13} /> Tekstiä on muokattu, eikä kohtaa löydy
                          enää.
                        </p>
                      )}
                      <button
                        type="button"
                        className="linklike"
                        onClick={() => removeRef(r.node.id, r.ref)}
                      >
                        Poista viite
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Korostusten selitykset">
      <li>
        <span className="m-ref">Teksti</span> liitetty vaiheeseen
      </li>
      <li>
        <span className="m-role">Rooli</span> tunnistettu
      </li>
      <li>
        <span className="m-system">Järjestelmä</span> tunnistettu
      </li>
      <li>
        <span className="m-sug">Ehdotus</span> vaiheeksi
      </li>
    </ul>
  )
}

function scrollToOffset(container: HTMLElement | null, offset: number) {
  if (!container) return
  const spans = container.querySelectorAll<HTMLElement>('[data-start]')
  let target: HTMLElement | undefined
  for (const s of spans) {
    if (Number(s.dataset.start) <= offset) target = s
    else break
  }
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** Tekstistä löydetyt uudet roolit ja järjestelmät: yhdellä klikkauksella malliin, jolloin ehdotukset saavat roolinsa. */
function CandidatePanel({ candidates }: { candidates: Candidate[] }) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const key = (c: Candidate) => `${c.kind}:${c.name}`
  const chosen = candidates.filter((c) => (c.likely ? !off.has(key(c)) : off.has(key(c))))
  const toggle = (c: Candidate) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(key(c))) next.delete(key(c))
      else next.add(key(c))
      return next
    })
  const addChosen = () => {
    const project = useStore.getState().project
    if (!project) return
    const ops: Operation[] = []
    for (const c of chosen) ops.push(...ensureEntity(project, c.kind, c.name, ops).ops)
    useStore.getState().dispatch(ops)
  }
  return (
    <div className="candidates" data-testid="candidates">
      <h4>Löydetyt roolit ja järjestelmät</h4>
      <p className="field__hint">
        Lisää nämä ensin, niin ehdotukset saavat roolinsa ja järjestelmänsä automaattisesti.
      </p>
      {(['role', 'system'] as const).map((kind) => {
        const group = candidates.filter((c) => c.kind === kind)
        if (group.length === 0) return null
        return (
          <div key={kind} className="candidates__group">
            <span className="candidates__label">{kind === 'role' ? 'Roolit' : 'Järjestelmät'}</span>
            <ul className="candidates__list">
              {group.map((c) => {
                const on = c.likely ? !off.has(key(c)) : off.has(key(c))
                return (
                  <li key={key(c)}>
                    <label
                      className={`chip-check ${on ? 'is-on' : ''}`}
                      title={`${c.count} mainintaa`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(c)} />
                      {c.name} <span className="muted">{c.count}×</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      <button
        type="button"
        disabled={chosen.length === 0}
        onClick={addChosen}
        data-testid="candidates-add"
      >
        Lisää valitut ({chosen.length})
      </button>
    </div>
  )
}
