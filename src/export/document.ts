import type { Gap } from '../analysis/gaps'
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
  <td>${nextText}</td>
  <td>${esc(node.description ?? '')}${node.confidence !== 'confirmed' ? ` <span class="conf conf--${node.confidence}">${CONF[node.confidence]}</span>` : ''}</td>
</tr>`
      })
      .join('\n')

    const matrixHead = roleIds
      .map((r) => `<th scope="col">${esc(p.entities[r]?.name ?? '')}</th>`)
      .join('')
    const matrixRows = rows
      .filter((r) => r.node.kind !== 'decision')
      .map(
        ({ node }) =>
          `<tr><th scope="row">${numbering.get(node.id)}. ${esc(node.label)}</th>${roleIds
            .map((r) => `<td class="mark">${node.roleId === r ? '●' : ''}</td>`)
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
<table class="steps"><thead><tr><th>#</th><th scope="col">Vaihe</th><th scope="col">Rooli</th><th scope="col">Järjestelmät</th><th scope="col">Syötteet</th><th scope="col">Tuotokset</th><th scope="col">Seuraava</th><th scope="col">Huomiot</th></tr></thead>
<tbody>
${tr}
</tbody></table>`
    : '<p class="muted">Ei vaiheita.</p>'
}
${
  roleIds.length
    ? `<h4>Vastuumatriisi</h4>
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
${questions}
</main>
${script}
</body>
</html>
`
}
