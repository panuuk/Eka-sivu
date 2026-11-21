import type { Comparison } from '../analysis/compare'
import type { Gap } from '../analysis/gaps'
import { metricsOf, summarizeScope } from '../analysis/metrics'
import { raciStateOf } from '../model/commands'
import { formatRange, formatTotal } from '../model/duration'
import { flowOrder } from '../model/flow'
import { processTree } from '../model/selectors'
import type { ProcessCard, Project } from '../model/types'
import { esc } from './svg'
import { fontStack, sanitizeTheme, themeColors, type Theme } from './theme'

export interface DocumentOptions {
  /** Prosessi, josta dokumentti alkaa (alaprosessit mukaan). */
  processId: string
  theme: Theme
  /** Valmiit SVG-kuvat prosesseittain (renderSvg). Puuttuva kuva jätetään pois. */
  svgs: Record<string, string>
  /** Liitä loppuun avoimet kysymykset (työmuistiinpanot). */
  includeQuestions: boolean
  questions?: Gap[]
  /** Klikkaus kaaviossa korostaa taulukon rivin. Itsenäiseen HTML-tiedostoon. */
  interactive: boolean
  /** Palautetila (vaatii interaktiivisen): lukija voi kommentoida vaiheita ja vastata avoimiin kysymyksiin. */
  review?: boolean
  generatedAt?: Date
  /** Muutosluettelo lähtötilaan verrattuna. */
  comparison?: { comparison: Comparison; baseName: string }
}

const INTERACTIVE_CSS = `
.pk-toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: .75rem; align-items: center; padding: .5rem .75rem; margin: -1rem 0 1rem; background: var(--bg); border-bottom: 1px solid var(--border); }
.pk-toolbar input { padding: .3rem .5rem; border: 1px solid var(--border); border-radius: 6px; min-width: 14rem; font: inherit; }
.pk-toolbar button, .pk-panel button { font: inherit; padding: .25rem .6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface2); color: var(--text); cursor: pointer; }
.pk-panel { position: fixed; right: 1rem; bottom: 1rem; width: min(24rem, calc(100vw - 2rem)); max-height: 70vh; overflow: auto; padding: 1rem; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 30px rgb(0 0 0 / 20%); z-index: 10; }
.pk-panel h3 { margin: 0 2rem .5rem 0; }
.pk-panel dl { margin: 0 0 .5rem; display: grid; grid-template-columns: auto 1fr; gap: .2rem .75rem; font-size: .9rem; }
.pk-panel dt { color: var(--muted); }
.pk-panel dd { margin: 0; }
#pk-close { position: absolute; top: .5rem; right: .5rem; }
svg g[data-id] { cursor: pointer; }
.pk-review { margin-top: .75rem; padding-top: .5rem; border-top: 1px solid var(--border); display: grid; gap: .4rem; }
.pk-review textarea, .pk-fb textarea { width: 100%; box-sizing: border-box; font: inherit; padding: .4rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.pk-fb { position: fixed; left: 1rem; bottom: 1rem; width: min(30rem, calc(100vw - 2rem)); max-height: 75vh; overflow: auto; padding: 1rem; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 30px rgb(0 0 0 / 20%); z-index: 11; }
.pk-fb h3 { margin: 0 0 .5rem; }
.pk-fb ul { margin: 0 0 .75rem; padding-left: 1.1rem; }
.pk-fb li { margin-bottom: .4rem; }
.pk-fb .pk-q { margin-bottom: .75rem; }
.pk-fb button, .pk-review button { font: inherit; padding: .25rem .6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface2); color: var(--text); cursor: pointer; }
@media print { .pk-toolbar, .pk-panel { display: none !important; } }
`

const CONF = { guess: 'arvaus', likely: 'todennäköinen', confirmed: 'vahvistettu' } as const

function descendantsInOrder(p: Project, rootId: string): { id: string; depth: number }[] {
  const tree = processTree(p)
  const start = tree.findIndex((t) => t.process.id === rootId)
  if (start < 0) return []
  const base = tree[start].depth
  const out: { id: string; depth: number }[] = []
  for (let i = start; i < tree.length; i++) {
    if (i > start && tree[i].depth <= base) break
    out.push({ id: tree[i].process.id, depth: tree[i].depth - base })
  }
  return out
}

const names = (p: Project, ids: string[]) =>
  ids
    .map((i) => p.entities[i]?.name)
    .filter(Boolean)
    .join(', ')

/** Prosessikortti HTML:nä: tiedot määrittelylistana ja listat omina otsikkoinaan. */
function cardHtml(card: ProcessCard | undefined): string {
  if (!card) return ''
  const rows: [string, string | undefined][] = [
    ['Tarkoitus', card.purpose],
    ['Omistaja', card.owner],
    ['Käynnistäjä', card.trigger],
    ['Asiakas', card.customer],
  ]
  const dl = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v!)}</dd>`)
    .join('')
  const lists: [string, string[] | undefined][] = [
    ['Tuotokset', card.outputs],
    ['Mittarit', card.metrics],
    ['Riskit', card.risks],
    ['Tarkistuslista', card.checklist],
  ]
  const ul = lists
    .filter(([, v]) => v?.length)
    .map(
      ([k, v]) =>
        `<div class="card__list"><h4>${esc(k)}</h4><ul${k === 'Tarkistuslista' ? ' class="checklist"' : ''}>${v!.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`,
    )
    .join('')
  if (!dl && !ul) return ''
  return `<div class="processcard">${dl ? `<dl>${dl}</dl>` : ''}${ul}</div>`
}

export function buildDocumentHtml(p: Project, opts: DocumentOptions): string {
  const theme = sanitizeTheme(opts.theme)
  const c = themeColors(theme)
  const processes = descendantsInOrder(p, opts.processId)
  const root = p.processes[opts.processId]
  const when = (opts.generatedAt ?? new Date()).toLocaleDateString('fi-FI')
  const sections: string[] = []
  const metrics = metricsOf(p)
  const anyTiming = Object.values(p.nodes).some((n) => n.duration || n.waiting)
  const anyRaci = Object.values(p.nodes).some(
    (n) =>
      n.raci?.accountableIds?.length || n.raci?.consultedIds?.length || n.raci?.informedIds?.length,
  )

  const processMetricsHtml = (id: string) => {
    const m = metrics.perProcess.get(id)
    if (!m) return ''
    const items: string[] = []
    if (m.lead.typicalHigh !== undefined) {
      const range =
        m.lead.typicalLow !== undefined && m.lead.typicalLow !== m.lead.typicalHigh
          ? `${formatTotal(m.lead.typicalLow)}–${formatTotal(m.lead.typicalHigh)}`
          : formatTotal(m.lead.typicalHigh)
      items.push(
        `<li><strong>Läpimenoaika:</strong> ${esc(range)} (nopeimmillaan ${esc(formatTotal(m.lead.best ?? 0))}, hitaimmillaan ${esc(formatTotal(m.lead.worst ?? 0))}). Arvio kattaa ${m.lead.coveredSteps}/${m.lead.pathSteps} vaihetta pisimmällä polulla.</li>`,
      )
    }
    if (m.handoffs.length) {
      const pairs = summarizeScope(p, metrics.perProcess, [id])
        .rolePairs.slice(0, 5)
        .map(
          (r) =>
            `${esc(p.entities[r.fromRoleId]?.name ?? '')} → ${esc(p.entities[r.toRoleId]?.name ?? '')} (${r.count})`,
        )
        .join(', ')
      items.push(`<li><strong>Luovutukset:</strong> ${m.handoffs.length}. ${pairs}</li>`)
    }
    if (m.loops.length)
      items.push(
        `<li><strong>Uudelleenkierrokset:</strong> ${m.loops.length}${m.loops.map((l) => ` · ${esc(p.nodes[l.fromId]?.label ?? '')} → ${esc(p.nodes[l.toId]?.label ?? '')}${l.extraMinutes !== undefined ? ` (+${esc(formatTotal(l.extraMinutes))})` : ''}`).join('')}</li>`,
      )
    return items.length ? `<h4>Mittarit</h4><ul class="metrics">${items.join('')}</ul>` : ''
  }

  processes.forEach(({ id, depth }, index) => {
    const proc = p.processes[id]
    const rows = flowOrder(p, id).filter((r) => r.node.kind !== 'start' && r.node.kind !== 'end')
    const roleIds = [...new Set(rows.map((r) => r.node.roleId).filter(Boolean) as string[])]
    const numbering = new Map(rows.map((r, i) => [r.node.id, i + 1]))

    const tr = rows
      .map(({ node, next }) => {
        const nextText = next
          .map((n) => `${n.label ? `${esc(n.label)}: ` : ''}${esc(p.nodes[n.id]?.label ?? '')}`)
          .join('<br>')
        return `<tr id="row-${esc(node.id)}" data-node="${esc(node.id)}">
  <td class="num">${numbering.get(node.id)}</td>
  <th scope="row">${esc(node.label)}${node.kind === 'decision' ? ' <span class="tag">päätös</span>' : ''}${node.kind === 'subprocess' ? ' <span class="tag">alaprosessi</span>' : ''}</th>
  <td>${esc(node.roleId ? (p.entities[node.roleId]?.name ?? '') : '')}</td>
  <td>${esc(names(p, node.systemIds))}</td>
  <td>${esc(names(p, node.inputIds))}</td>
  <td>${esc(names(p, node.outputIds))}</td>
  ${anyTiming ? `<td>${esc(formatRange(node.duration))}</td><td>${esc(formatRange(node.waiting))}</td>` : ''}
  <td>${nextText}</td>
  <td>${esc(node.description ?? '')}${node.checklist?.length ? `<ul class="checklist">${node.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}${node.confidence !== 'confirmed' ? ` <span class="conf conf--${node.confidence}">${CONF[node.confidence]}</span>` : ''}</td>
</tr>`
      })
      .join('\n')

    // Matriisiin otetaan mukaan myös RACI-roolit
    if (anyRaci) {
      for (const { node } of rows)
        for (const r of [
          ...(node.raci?.accountableIds ?? []),
          ...(node.raci?.consultedIds ?? []),
          ...(node.raci?.informedIds ?? []),
        ])
          if (!roleIds.includes(r)) roleIds.push(r)
    }
    const matrixHead = roleIds
      .map((r) => `<th scope="col">${esc(p.entities[r]?.name ?? '')}</th>`)
      .join('')
    const matrixRows = rows
      .filter((r) => r.node.kind !== 'decision')
      .map(
        ({ node }) =>
          `<tr><th scope="row">${numbering.get(node.id)}. ${esc(node.label)}</th>${roleIds
            .map((r) => {
              const st = raciStateOf(p, node.id, r)
              return `<td class="mark">${anyRaci ? st : st === 'R' ? '●' : ''}</td>`
            })
            .join('')}</tr>`,
      )
      .join('\n')

    sections.push(`<section class="process" id="process-${esc(id)}">
<h${Math.min(2 + depth, 4)}>${index + 1}. ${esc(proc.name)}</h${Math.min(2 + depth, 4)}>
${proc.description ? `<p class="lead">${esc(proc.description)}</p>` : ''}
${cardHtml(proc.card)}
${opts.svgs[id] ? `<figure class="diagram">${opts.svgs[id]}</figure>` : ''}
${
  rows.length
    ? `<h4>Vaiheet</h4>
<table class="steps"><thead><tr><th>#</th><th scope="col">Vaihe</th><th scope="col">Rooli</th><th scope="col">Järjestelmät</th><th scope="col">Syötteet</th><th scope="col">Tuotokset</th>${anyTiming ? '<th scope="col">Kesto</th><th scope="col">Odotus</th>' : ''}<th scope="col">Seuraava</th><th scope="col">Huomiot</th></tr></thead>
<tbody>
${tr}
</tbody></table>`
    : '<p class="muted">Ei vaiheita.</p>'
}
${processMetricsHtml(id)}
${
  roleIds.length
    ? `<h4>${anyRaci ? 'RACI-matriisi' : 'Vastuumatriisi'}</h4>
<table class="matrix"><thead><tr><th scope="col">Vaihe</th>${matrixHead}</tr></thead>
<tbody>
${matrixRows}
</tbody></table>`
    : ''
}
</section>`)
  })

  // Liite: roolien, järjestelmien ja tuotosten käyttö
  const used = new Set<string>()
  for (const { id } of processes)
    for (const n of Object.values(p.nodes))
      if (n.processId === id) {
        if (n.roleId) used.add(n.roleId)
        for (const e of [...n.systemIds, ...n.inputIds, ...n.outputIds]) used.add(e)
      }
  const entityList = (kind: 'role' | 'system' | 'artifact', title: string) => {
    const list = Object.values(p.entities)
      .filter((e) => e.kind === kind && used.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'fi'))
    if (!list.length) return ''
    return `<h4>${title}</h4><ul class="entities">${list.map((e) => `<li>${esc(e.name)}${e.description ? ` – ${esc(e.description)}` : ''}${e.aliases.length ? ` <span class="muted">(${esc(e.aliases.join(', '))})</span>` : ''}</li>`).join('')}</ul>`
  }
  const appendix = `<section class="appendix"><h2>Liite: roolit, järjestelmät ja tuotokset</h2>${entityList('role', 'Roolit')}${entityList('system', 'Järjestelmät')}${entityList('artifact', 'Syötteet ja tuotokset')}</section>`

  const scopeIds = processes.map((x) => x.id)
  const pains = summarizeScope(p, metrics.perProcess, scopeIds).painPoints
  const painSection = pains.length
    ? `<section class="appendix"><h2>Liite: kipupisteet ja parannusideat</h2><table class="pains"><thead><tr><th scope="col">Vaihe</th><th scope="col">Kipupiste</th><th scope="col">Vakavuus</th><th scope="col">Parannusidea</th></tr></thead><tbody>${pains
        .map(
          (x) =>
            `<tr><th scope="row">${esc(p.nodes[x.nodeId]?.label ?? '')}</th><td>${esc(x.text)}</td><td>${['', 'pieni', 'kohtalainen', 'vakava'][x.severity]}</td><td>${esc(x.idea ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table></section>`
    : ''

  const changeSection = (() => {
    const cm = opts.comparison
    if (!cm) return ''
    const c = cm.comparison
    const KIND = { added: 'Lisätty', removed: 'Poistettu', changed: 'Muuttunut' } as const
    const nodeRows = c.nodes
      .map(
        (n) =>
          `<tr class="chg chg--${n.kind}"><td>${KIND[n.kind]}</td><th scope="row">${esc(n.label)}</th><td>${esc(n.processName)}</td><td>${n.fields.map((f) => `${esc(f.label)}: ${esc(f.before)} → ${esc(f.after)}`).join('<br>')}</td></tr>`,
      )
      .join('')
    const edgeRows = c.edges
      .map(
        (e) =>
          `<li>${KIND[e.kind]}: ${esc(e.fromLabel)} → ${esc(e.toLabel)}${e.kind === 'changed' ? ` (${esc(e.before ?? '')} → ${esc(e.after ?? '')})` : ''}</li>`,
      )
      .join('')
    const metric = (label: string, a: string, b: string) =>
      `<li><strong>${label}:</strong> ${a} → ${b}</li>`
    const t = (n?: number) => (n === undefined ? '–' : formatTotal(n))
    return `<section class="appendix"><h2>Muutokset lähtötilaan “${esc(cm.baseName)}” verrattuna</h2>
<p>${c.counts.added} lisätty, ${c.counts.removed} poistettu, ${c.counts.changed} muuttunut vaihe; ${c.counts.edgesAdded} uutta ja ${c.counts.edgesRemoved} poistunutta yhteyttä.</p>
<ul class="metrics">${metric('Vaiheet', String(c.base.steps), String(c.target.steps))}${metric('Luovutukset', String(c.base.handoffs), String(c.target.handoffs))}${metric('Kierrokset', String(c.base.loops), String(c.target.loops))}${metric('Läpimeno', t(c.base.lead?.high), t(c.target.lead?.high))}${metric('Työaika', t(c.base.effort), t(c.target.effort))}${metric('Odotus', t(c.base.waiting), t(c.target.waiting))}</ul>
${c.nodes.length ? `<table class="changes"><thead><tr><th scope="col">Muutos</th><th scope="col">Vaihe</th><th scope="col">Prosessi</th><th scope="col">Tiedot</th></tr></thead><tbody>${nodeRows}</tbody></table>` : '<p class="muted">Ei muutoksia vaiheissa.</p>'}
${edgeRows ? `<h4>Yhteydet</h4><ul>${edgeRows}</ul>` : ''}
</section>`
  })()

  const questions =
    opts.includeQuestions && opts.questions?.length
      ? `<section class="appendix"><h2>Avoimet kysymykset</h2><ul class="questions">${opts.questions
          .map(
            (g) =>
              `<li>${esc(g.text)} <span class="muted">(${esc(p.processes[g.processId]?.name ?? '')})</span></li>`,
          )
          .join('')}</ul></section>`
      : ''

  /** Vaiheiden tiedot interaktiiviseen tiedostoon. JSON upotetaan skriptilohkoon, joten merkit < > & ja rivinvaihtomerkit koodataan. */
  const nodeData: Record<string, unknown> = {}
  if (opts.interactive) {
    const ids = new Set(processes.map((x) => x.id))
    for (const n of Object.values(p.nodes)) {
      if (!ids.has(n.processId) || n.kind === 'start' || n.kind === 'end') continue
      const list = (xs: string[]) => xs.map((i) => p.entities[i]?.name).filter(Boolean)
      nodeData[n.id] = {
        label: n.label,
        kind: n.kind,
        process: p.processes[n.processId]?.name ?? '',
        child:
          n.childProcessId && ids.has(n.childProcessId) ? `process-${n.childProcessId}` : undefined,
        role: n.roleId ? p.entities[n.roleId]?.name : undefined,
        systems: list(n.systemIds),
        inputs: list(n.inputIds),
        outputs: list(n.outputIds),
        duration: n.duration ? formatRange(n.duration) : undefined,
        waiting: n.waiting ? formatRange(n.waiting) : undefined,
        frequency: n.frequency,
        confidence: CONF[n.confidence],
        description: n.description,
        checklist: n.checklist,
        pains: (n.painPoints ?? []).map((x) => ({ text: x.text, idea: x.idea })),
      }
    }
  }
  const dataJson = JSON.stringify(nodeData)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

  const review = !!opts.interactive && !!opts.review
  // Palautetilan tiedot: hanke ja avoimet kysymykset (vain tämän dokumentin prosesseista)
  const reviewJson = review
    ? JSON.stringify({
        projectId: p.id,
        projectName: p.name,
        questions: (opts.questions ?? [])
          .filter((g) => processes.some((x) => x.id === g.processId))
          .slice(0, 60)
          .map((g) => ({
            key: g.key,
            text: g.text,
            nodeId: g.targetId && p.nodes[g.targetId] ? g.targetId : undefined,
            nodeLabel: g.targetId ? p.nodes[g.targetId]?.label : undefined,
          })),
      })
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
    : ''
  const toolbar = opts.interactive
    ? `<div class="pk-toolbar" role="search"><label>Hae vaiheita <input id="pk-search" type="search" placeholder="Nimi, rooli, järjestelmä…" autocomplete="off"></label><span id="pk-count" class="muted" role="status"></span><button type="button" id="pk-back" hidden>← Takaisin</button>${review ? '<label>Nimesi <input id="pk-reviewer" type="text" autocomplete="name" placeholder="Kuka kommentoi?"></label><button type="button" id="pk-fb-open">Palaute (<span id="pk-fb-count">0</span>)</button>' : ''}</div>`
    : ''
  const panel = opts.interactive
    ? `<aside id="pk-panel" class="pk-panel" hidden aria-live="polite"><button type="button" id="pk-close" aria-label="Sulje tiedot">×</button><h3 id="pk-title"></h3><dl id="pk-details"></dl><button type="button" id="pk-open" hidden>Avaa alaprosessi</button>${review ? '<div class="pk-review"><label for="pk-comment">Kommentti tähän vaiheeseen</label><textarea id="pk-comment" rows="3"></textarea><button type="button" id="pk-comment-add">Lisää kommentti</button></div>' : ''}</aside>${review ? '<aside id="pk-fb" class="pk-fb" hidden aria-label="Palaute"><button type="button" id="pk-fb-close" aria-label="Sulje palaute" style="float:right">×</button><h3>Palaute</h3><h4>Kommentit</h4><ul id="pk-fb-comments"></ul><p id="pk-fb-none" class="muted">Ei kommentteja vielä. Valitse vaihe kaaviosta ja kirjoita kommentti.</p><h4>Avoimet kysymykset</h4><div id="pk-fb-questions"></div><button type="button" id="pk-fb-save">Tallenna palaute tiedostoksi</button><p class="muted">Lähetä tallennettu tiedosto prosessin laatijalle.</p></aside>' : ''}`
    : ''

  const reviewScript = review
    ? `<script type="application/json" id="pk-review-data">${reviewJson}</script>
<script>
(function () {
  var meta = JSON.parse(document.getElementById('pk-review-data').textContent)
  var data = JSON.parse(document.getElementById('pk-data').textContent)
  var comments = []
  var answers = {}
  var current = null
  var box = document.getElementById('pk-fb')
  var list = document.getElementById('pk-fb-comments')
  var none = document.getElementById('pk-fb-none')
  var qbox = document.getElementById('pk-fb-questions')
  var countEl = document.getElementById('pk-fb-count')
  var comment = document.getElementById('pk-comment')
  var reviewer = document.getElementById('pk-reviewer')

  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('svg [data-id]') : null
    if (g && data[g.getAttribute('data-id')]) current = g.getAttribute('data-id')
  })
  function nCount() { return comments.length + Object.keys(answers).filter(function (k) { return answers[k] }).length }
  function renderComments() {
    list.textContent = ''
    comments.forEach(function (c, i) {
      var li = document.createElement('li')
      var b = document.createElement('b'); b.textContent = c.nodeLabel + ': '
      li.appendChild(b); li.appendChild(document.createTextNode(c.text + ' '))
      var rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Poista'
      rm.addEventListener('click', function () { comments.splice(i, 1); renderComments() })
      li.appendChild(rm); list.appendChild(li)
    })
    none.hidden = comments.length > 0
    countEl.textContent = String(nCount())
  }
  meta.questions.forEach(function (q) {
    var d = document.createElement('div'); d.className = 'pk-q'
    var l = document.createElement('label'); l.textContent = (q.nodeLabel ? q.nodeLabel + ': ' : '') + q.text
    var t = document.createElement('textarea'); t.rows = 2; t.setAttribute('aria-label', 'Vastaus: ' + q.text)
    t.addEventListener('input', function () { answers[q.key] = t.value.trim(); countEl.textContent = String(nCount()) })
    l.appendChild(document.createElement('br')); d.appendChild(l); d.appendChild(t); qbox.appendChild(d)
  })
  if (!meta.questions.length) qbox.textContent = 'Ei avoimia kysymyksiä.'
  document.getElementById('pk-comment-add').addEventListener('click', function () {
    var text = comment.value.trim()
    if (!current || !text) return
    comments.push({ nodeId: current, nodeLabel: data[current].label, text: text })
    comment.value = ''
    renderComments()
  })
  document.getElementById('pk-fb-open').addEventListener('click', function () { box.hidden = !box.hidden })
  document.getElementById('pk-fb-close').addEventListener('click', function () { box.hidden = true })
  document.getElementById('pk-fb-save').addEventListener('click', function () {
    var items = comments.map(function (c, i) { return { id: 'c' + i, type: 'comment', nodeId: c.nodeId, nodeLabel: c.nodeLabel, text: c.text } })
    meta.questions.forEach(function (q) {
      if (answers[q.key]) items.push({ id: 'a' + q.key, type: 'answer', questionKey: q.key, questionText: q.text, nodeId: q.nodeId, nodeLabel: q.nodeLabel, text: answers[q.key] })
    })
    var out = { app: 'prosessikartta-palaute', version: 1, projectId: meta.projectId, projectName: meta.projectName, reviewer: (reviewer.value || '').trim(), createdAt: Date.now(), items: items }
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'palaute.prosessikartta-palaute.json'
    document.body.appendChild(a); a.click(); a.remove()
  })
  renderComments()
})()
</script>`
    : ''
  const script = opts.interactive
    ? `<script type="application/json" id="pk-data">${dataJson}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('pk-data').textContent)
  var panel = document.getElementById('pk-panel')
  var title = document.getElementById('pk-title')
  var details = document.getElementById('pk-details')
  var openBtn = document.getElementById('pk-open')
  var back = document.getElementById('pk-back')
  var search = document.getElementById('pk-search')
  var count = document.getElementById('pk-count')
  var history = []
  var currentChild = null

  function clearHl() { document.querySelectorAll('tr.hl').forEach(function (r) { r.classList.remove('hl') }) }
  function addRow(label, value) {
    if (!value || (Array.isArray(value) && !value.length)) return
    var dt = document.createElement('dt'); dt.textContent = label
    var dd = document.createElement('dd'); dd.textContent = Array.isArray(value) ? value.join(', ') : value
    details.appendChild(dt); details.appendChild(dd)
  }
  function show(id) {
    var d = data[id]
    if (!d) { panel.hidden = true; return }
    title.textContent = d.label
    details.textContent = ''
    addRow('Prosessi', d.process)
    addRow('Rooli', d.role)
    addRow('Järjestelmät', d.systems)
    addRow('Syötteet', d.inputs)
    addRow('Tuotokset', d.outputs)
    addRow('Työaika', d.duration)
    addRow('Odotus', d.waiting)
    addRow('Toistuvuus', d.frequency)
    addRow('Varmuus', d.confidence)
    addRow('Kuvaus', d.description)
    ;(d.pains || []).forEach(function (p) { addRow('Kipupiste', p.text + (p.idea ? ' → ' + p.idea : '')) })
    currentChild = d.child || null
    openBtn.hidden = !currentChild
    panel.hidden = false
  }
  function goTo(sectionId) {
    var el = document.getElementById(sectionId)
    if (!el) return
    history.push(window.scrollY)
    back.hidden = false
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('svg [data-id]') : null
    clearHl()
    if (!g) return
    var id = g.getAttribute('data-id')
    var row = document.getElementById('row-' + id)
    if (row) { row.classList.add('hl'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
    show(id)
    // Alaprosessiin porautuminen: kaksoisnapsautus avaa sen osion
  })
  document.addEventListener('dblclick', function (e) {
    var g = e.target.closest ? e.target.closest('svg [data-id]') : null
    var d = g && data[g.getAttribute('data-id')]
    if (d && d.child) goTo(d.child)
  })
  openBtn.addEventListener('click', function () { if (currentChild) goTo(currentChild) })
  back.addEventListener('click', function () {
    var y = history.pop()
    if (y !== undefined) window.scrollTo({ top: y, behavior: 'smooth' })
    if (!history.length) back.hidden = true
  })
  document.getElementById('pk-close').addEventListener('click', function () { panel.hidden = true; clearHl() })

  function norm(s) { return String(s || '').toLocaleLowerCase('fi') }
  search.addEventListener('input', function () {
    var q = norm(search.value).trim()
    var hits = 0
    document.querySelectorAll('svg g[data-id]').forEach(function (g) {
      var d = data[g.getAttribute('data-id')]
      var text = d ? norm([d.label, d.role, (d.systems || []).join(' '), (d.inputs || []).join(' '), (d.outputs || []).join(' '), d.description].join(' ')) : ''
      var match = !q || (d && text.indexOf(q) >= 0)
      if (q && match) hits++
      g.style.opacity = match ? '' : '0.18'
    })
    document.querySelectorAll('table.steps tbody tr').forEach(function (r) {
      var id = (r.getAttribute('data-node') || '')
      var d = data[id]
      var text = d ? norm([d.label, d.role, (d.systems || []).join(' '), (d.description || '')].join(' ')) : norm(r.textContent)
      r.style.display = !q || text.indexOf(q) >= 0 ? '' : 'none'
    })
    count.textContent = q ? hits + ' osumaa' : ''
  })
})()
</script>${reviewScript}`
    : ''

  return `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Prosessikartta">
<title>${esc(root?.name ?? 'Prosessi')} – prosessidokumentti</title>
<style>
:root { color-scheme: light; --bg: ${c.bg}; --text: ${c.text}; --muted: ${c.muted}; --border: ${c.border}; --accent: ${c.accent}; --surface2: ${c.surface2}; --ok: ${c.ok}; --warn: ${c.warn}; }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1.5rem 4rem; background: var(--bg); color: var(--text); font: 15px/1.5 ${fontStack(theme)}; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 2rem; margin: 0 0 .25rem; }
h2 { margin-top: 2.5rem; border-bottom: 2px solid var(--accent); padding-bottom: .25rem; }
h3, h4 { margin-top: 1.5rem; }
.meta, .muted { color: var(--muted); }
.lead { font-size: 1.05rem; }
.processcard { display: grid; gap: .5rem 1.5rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); margin: .5rem 0 1rem; padding: .75rem 1rem; background: var(--surface2); border-radius: 8px; }
.processcard dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: .15rem .75rem; }
.processcard dt { font-weight: 600; }
.processcard dd { margin: 0; }
.processcard h4 { margin: 0 0 .2rem; }
.processcard ul { margin: 0; padding-left: 1.1rem; }
ul.checklist { list-style: none; padding-left: 0; }
ul.checklist li::before { content: '☐ '; }
.diagram { margin: 1rem 0; padding: .5rem; border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
.diagram svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .9rem; }
th, td { border: 1px solid var(--border); padding: .35rem .55rem; text-align: left; vertical-align: top; }
thead th { background: var(--surface2); }
.num, .mark { text-align: center; width: 2.5rem; }
.tag, .conf { font-size: .72rem; padding: 0 .45em; border-radius: 999px; background: var(--surface2); color: var(--muted); }
.conf--guess { color: var(--warn); }
tr.hl { outline: 3px solid var(--accent); background: var(--surface2); }
${opts.interactive ? INTERACTIVE_CSS : ''}
svg [data-id] { cursor: ${opts.interactive ? 'pointer' : 'default'}; }
.entities { columns: 2; }
@media print {
  body { padding: 0; font-size: 11pt; }
  .process { break-inside: avoid-page; page-break-before: always; }
  .process:first-of-type { page-break-before: auto; }
  .diagram { break-inside: avoid; overflow: visible; border: 0; }
  table { break-inside: auto; } tr { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
</style>
</head>
<body>
<main>
${toolbar}
<header>
<h1>${esc(root?.name ?? 'Prosessi')}</h1>
<p class="meta">${esc(p.name)} · ${esc(when)}</p>
${root?.description ? `<p class="lead">${esc(root.description)}</p>` : ''}
</header>
${sections.join('\n')}
${appendix}
${painSection}
${changeSection}
${questions}
</main>
${panel}
${script}
</body>
</html>
`
}
