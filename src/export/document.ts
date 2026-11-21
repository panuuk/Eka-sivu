import type { Comparison } from '../analysis/compare'
import type { Gap } from '../analysis/gaps'
import { metricsOf, summarizeScope } from '../analysis/metrics'
import { raciStateOf } from '../model/commands'
import { formatRange, formatTotal } from '../model/duration'
import { flowOrder } from '../model/flow'
import { processTree } from '../model/selectors'
import type { Project } from '../model/types'
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
  generatedAt?: Date
  /** Muutosluettelo lähtötilaan verrattuna. */
  comparison?: { comparison: Comparison; baseName: string }
}

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
  <td>${esc(node.description ?? '')}${node.confidence !== 'confirmed' ? ` <span class="conf conf--${node.confidence}">${CONF[node.confidence]}</span>` : ''}</td>
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
    return `<h4>${title}</h4><ul class="entities">${list.map((e) => `<li>${esc(e.name)}${e.aliases.length ? ` <span class="muted">(${esc(e.aliases.join(', '))})</span>` : ''}</li>`).join('')}</ul>`
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

  const script = opts.interactive
    ? `<script>
(function () {
  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('svg [data-id]') : null
    document.querySelectorAll('tr.hl').forEach(function (r) { r.classList.remove('hl') })
    if (!g) return
    var row = document.getElementById('row-' + g.getAttribute('data-id'))
    if (row) { row.classList.add('hl'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  })
})()
</script>`
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
.diagram { margin: 1rem 0; padding: .5rem; border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
.diagram svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .9rem; }
th, td { border: 1px solid var(--border); padding: .35rem .55rem; text-align: left; vertical-align: top; }
thead th { background: var(--surface2); }
.num, .mark { text-align: center; width: 2.5rem; }
.tag, .conf { font-size: .72rem; padding: 0 .45em; border-radius: 999px; background: var(--surface2); color: var(--muted); }
.conf--guess { color: var(--warn); }
tr.hl { outline: 3px solid var(--accent); background: var(--surface2); }
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
${script}
</body>
</html>
`
}
