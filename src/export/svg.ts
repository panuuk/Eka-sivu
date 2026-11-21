import { labelPoint, roundedPath } from '../canvas/routes'
import { entityColor } from '../model/flow'
import type { RenderGraph, RNode } from './graph'
import { fontStack, themeColors, type Theme } from './theme'

export interface SvgOptions {
  theme: Theme
  showRoles: boolean
  showSystems: boolean
  /** Varmuus näkyviin: arvaus katkoviivalla, vahvistettu vihreällä. Pois päältä kaikki on yhtenäistä. */
  showUncertainty: boolean
  /** Kestot ja kipupisteet vaiheissa. */
  showMetrics?: boolean
  /** Lämpökartan tyyppi (värisävy). */
  heat?: 'off' | 'time' | 'pain' | 'handoff'
  /** Vertailun merkinnät: lisätty (vihreä), poistettu (punainen katkoviiva), muuttunut (keltainen). */
  marks?: ReadonlyMap<string, 'added' | 'removed' | 'changed'>
  /** Skenaariopolku: polun vaiheet ja yhteydet korostetaan, muut himmennetään ja vaiheet numeroidaan. */
  path?: {
    nodes: ReadonlySet<string>
    edges: ReadonlySet<string>
    order: ReadonlyMap<string, number>
  }
  /** Rajaa kuvan tähän alueeseen (graafin koordinaatit, marginaali lisätään). */
  crop?: { x: number; y: number; width: number; height: number }
  title?: string
  margin?: number
  /** Läpikäynti: korostettu vaihe ja jo käydyt; muut himmennetään. */
  highlight?: { current?: string; visited?: ReadonlySet<string> }
}

export const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Tekstin rivitys likimääräisellä merkkileveydellä (SVG:ssä ei ole automaattista rivitystä). */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur)
        cur = ''
      }
      lines.push(w.slice(0, maxChars))
      w = w.slice(maxChars)
    }
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= maxChars) cur += ` ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    const last = kept[maxLines - 1]
    kept[maxLines - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`
    return kept
  }
  return lines
}

/** Lyhentää yksirivisen tekstin merkkimäärään ja lisää ellipsin tarvittaessa. */
export function fitText(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= maxChars ? t : `${t.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

const charsFor = (width: number, fontSize: number) =>
  Math.max(4, Math.floor(width / (fontSize * 0.56)))

export function renderSvg(graph: RenderGraph, opts: SvgOptions): string {
  const c = themeColors(opts.theme)
  const print = opts.theme.palette === 'print'
  const margin = opts.margin ?? 32
  const area = opts.crop ?? { x: 0, y: 0, width: graph.width, height: graph.height }
  const width = Math.ceil(area.width + margin * 2)
  const height = Math.ceil(area.height + margin * 2)
  const vx = Math.floor(area.x - margin)
  const vy = Math.floor(area.y - margin)
  const hl = opts.highlight
  const pathSet = opts.path
  const dimmed = (id: string) =>
    (!!hl && hl.current !== undefined && id !== hl.current && !hl.visited?.has(id)) ||
    (!!pathSet && !pathSet.nodes.has(id))

  const parts: string[] = []
  const title = opts.title ?? 'Prosessikaavio'
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${width} ${height}" width="${width}" height="${height}" font-family="${esc(fontStack(opts.theme))}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c.borderStrong}"/></marker></defs>`,
    `<rect x="${vx}" y="${vy}" width="${width}" height="${height}" fill="${c.bg}"/>`,
  )

  // Ryhmät (avatut alaprosessit) ensin: syvyysjärjestyksessä, jotta sisäkkäiset ryhmät piirtyvät päälle.
  const groups = graph.nodes.filter((n) => n.group)
  for (const g of groups) {
    parts.push(
      `<g data-id="${esc(g.id)}" data-kind="group" class="group">`,
      `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="16" fill="${print ? 'none' : c.accent}" fill-opacity="${print ? 1 : 0.06}" stroke="${print ? c.borderStrong : c.accent}" stroke-opacity="${print ? 1 : 0.55}" stroke-width="2"/>`,
      `<text x="${g.x + 16}" y="${g.y + 27}" font-size="15" font-weight="700" fill="${c.text}">${esc(wrapLabel(g.label, charsFor(g.w - 100, 15), 1)[0] ?? '')}</text>`,
      `<text x="${g.x + g.w - 14}" y="${g.y + 26}" font-size="10" font-weight="700" fill="${print ? c.text : c.accent}" text-anchor="end" letter-spacing="0.6">ALAPROSESSI</text>`,
      `</g>`,
    )
  }

  // Reunat
  for (const e of graph.edges) {
    const path = roundedPath(e.points, 10)
    const faded =
      hl &&
      hl.current !== undefined &&
      !(hl.visited?.has(e.from) && (hl.visited?.has(e.to) || hl.current === e.to))
    const onPath = !pathSet || pathSet.edges.has(e.id)
    parts.push(
      `<g data-edge="${esc(e.id)}" opacity="${faded || !onPath ? 0.25 : 1}">`,
      pathSet && onPath
        ? `<path d="${path}" fill="none" stroke="${c.accent}" stroke-width="3" marker-end="url(#arrow)"/>`
        : `<path d="${path}" fill="none" stroke="${c.borderStrong}" stroke-width="1.6" marker-end="url(#arrow)"/>`,
    )
    if (e.label) {
      const lp = labelPoint(e.points)
      const w = Math.max(18, e.label.length * 6.6 + 12)
      parts.push(
        `<rect x="${lp.x - w / 2}" y="${lp.y - 10}" width="${w}" height="20" rx="5" fill="${c.bg}"/>`,
        `<text x="${lp.x}" y="${lp.y + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${c.text}">${esc(e.label)}</text>`,
      )
    }
    parts.push('</g>')
  }

  // Solmut
  for (const n of graph.nodes) {
    if (n.group) continue
    parts.push(renderNode(n, opts, c, print, dimmed(n.id), hl?.current === n.id))
    const order = pathSet?.order.get(n.id)
    if (order !== undefined) {
      parts.push(
        `<g data-order="${order}"><circle cx="${n.x + n.w - 4}" cy="${n.y + 4}" r="11" fill="${c.accent}"/>` +
          `<text x="${n.x + n.w - 4}" y="${n.y + 8.5}" font-size="12" font-weight="800" text-anchor="middle" fill="#fff">${order}</text></g>`,
      )
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}

function strokeFor(n: RNode, opts: SvgOptions, c: ReturnType<typeof themeColors>) {
  if (!opts.showUncertainty) return { stroke: c.borderStrong, width: 1.6, dash: '' }
  if (n.confidence === 'guess') return { stroke: c.borderStrong, width: 1.6, dash: '5 4' }
  if (n.confidence === 'confirmed') return { stroke: c.ok, width: 2, dash: '' }
  return { stroke: c.borderStrong, width: 1.6, dash: '' }
}

function renderNode(
  n: RNode,
  opts: SvgOptions,
  c: ReturnType<typeof themeColors>,
  print: boolean,
  dim: boolean,
  current: boolean,
): string {
  const s = strokeFor(n, opts, c)
  const mark = opts.marks?.get(n.id)
  const markColor = mark === 'added' ? c.ok : mark === 'removed' ? c.danger : c.warn
  const stroke = current ? c.accent : mark ? markColor : s.stroke
  const sw = current ? 3 : mark ? 3 : s.width
  const dash =
    mark === 'removed' ? ' stroke-dasharray="6 4"' : s.dash ? ` stroke-dasharray="${s.dash}"` : ''
  const open = `<g data-id="${esc(n.id)}" data-kind="${n.kind}" opacity="${dim ? 0.25 : 1}"${n.hasChild && n.kind === 'subprocess' ? ' data-has-child="1"' : ''}>`
  const out: string[] = [open]
  const glow = current ? ` filter="drop-shadow(0 0 6px ${c.accent})"` : ''

  if (n.kind === 'decision') {
    const { x, y, w, h } = n
    out.push(
      `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${mark && !print ? tint(markColor, c.surface, 0.16) : c.surface}" stroke="${stroke}" stroke-width="${sw}"${dash}${glow}/>`,
    )
    const lines = wrapLabel(n.label, charsFor(w * 0.62, 12.5), 3)
    const start = y + h / 2 - ((lines.length - 1) * 15) / 2 + 4
    lines.forEach((l, i) =>
      out.push(
        `<text x="${x + w / 2}" y="${start + i * 15}" font-size="12.5" font-weight="600" text-anchor="middle" fill="${c.text}">${esc(l)}</text>`,
      ),
    )
  } else if (n.kind === 'start' || n.kind === 'end') {
    const fill = print
      ? c.surface
      : n.kind === 'start'
        ? tint(c.ok, c.surface, 0.14)
        : tint(c.danger, c.surface, 0.1)
    out.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}${glow}/>`,
    )
    const lines = wrapLabel(n.label, charsFor(n.w - 20, 12.5), 2)
    const start = n.y + n.h / 2 - ((lines.length - 1) * 14) / 2 + 4
    lines.forEach((l, i) =>
      out.push(
        `<text x="${n.x + n.w / 2}" y="${start + i * 14}" font-size="12.5" font-weight="600" text-anchor="middle" fill="${c.text}">${esc(l)}</text>`,
      ),
    )
  } else {
    // Vaihe tai kutistettu alaprosessi
    if (n.kind === 'subprocess') {
      out.push(
        `<rect x="${n.x + 5}" y="${n.y + 5}" width="${n.w}" height="${n.h}" rx="12" fill="${c.surface}" stroke="${c.borderStrong}" stroke-width="1.4"/>`,
      )
    }
    const heatFill =
      mark && !print
        ? tint(markColor, c.surface, 0.16)
        : n.heat !== undefined && opts.heat && opts.heat !== 'off' && !print
          ? tint(
              opts.heat === 'pain' ? '#c62828' : opts.heat === 'handoff' ? '#7e3fd0' : '#e04a2f',
              c.surface,
              opts.heat === 'handoff' ? 0.28 : 0.1 + n.heat * 0.45,
            )
          : c.surface
    out.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${heatFill}" stroke="${stroke}" stroke-width="${sw}"${dash}${glow}/>`,
    )
    if (n.roleId && opts.showRoles && !print) {
      out.push(
        `<rect x="${n.x}" y="${n.y + 9}" width="4" height="${n.h - 18}" rx="2" fill="${entityColor(n.roleId)}"/>`,
      )
    }
    const tx = n.x + 15
    const textW = n.w - 28
    const meta: string[] = []
    if (opts.showRoles && n.roleName) meta.push(n.roleName)
    if (opts.showMetrics && n.timeText) meta.push(n.timeText)
    if (opts.showSystems && n.systems.length)
      meta.push(
        n.systems.slice(0, 2).join(', ') +
          (n.systems.length > 2 ? ` +${n.systems.length - 2}` : ''),
      )
    const labelLines = wrapLabel(n.label, charsFor(textW, 13.5), meta.length ? 2 : 3)
    const total = labelLines.length * 16 + (meta.length ? 4 + 14 : 0)
    let y = n.y + (n.h - total) / 2 + 13
    labelLines.forEach((l) => {
      out.push(
        `<text x="${tx}" y="${y}" font-size="13.5" font-weight="600" fill="${c.text}">${esc(l)}</text>`,
      )
      y += 16
    })
    if (meta.length) {
      const line = fitText(meta.join(' · '), charsFor(textW, 11))
      out.push(`<text x="${tx}" y="${y + 1}" font-size="11" fill="${c.muted}">${esc(line)}</text>`)
    }
  }
  if (opts.showMetrics && n.pain && n.kind !== 'start' && n.kind !== 'end') {
    const col = n.pain === 3 ? c.danger : n.pain === 2 ? '#c27a00' : c.borderStrong
    out.push(
      `<circle cx="${n.x + 2}" cy="${n.y + n.h - 2}" r="9" fill="${col}"/>`,
      `<text x="${n.x + 2}" y="${n.y + n.h + 2}" font-size="12" font-weight="800" text-anchor="middle" fill="#fff">!</text>`,
    )
  }
  out.push('</g>')
  return out.join('\n')
}

/** Sekoittaa värin pinnan väriin annetulla osuudella (SVG:ssä ei ole color-mixiä kaikkialla). */
export function tint(color: string, base: string, amount: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const a = parse(color)
  const b = parse(base)
  const mix = a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)))
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
