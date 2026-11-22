/**
 * Suurten kaavioiden tulostus usealle sivulle. Kuva jaetaan sivukokoisiin ruutuihin, jotka
 * tulostetaan peräkkäin ja jotka voi liittää yhteen isoksi seinäkaavioksi.
 */

type Paper = 'fit' | 'A4' | 'A3'
type Orientation = 'landscape' | 'portrait'
/** `width`: kuvan leveys sovitetaan yhteen sivuun (vain korkeus jakautuu). `actual`: 100 %. */
type ScaleMode = 'width' | 'actual'

export interface TileOptions {
  paper: Paper
  orientation: Orientation
  scale: ScaleMode
}

export const DEFAULT_TILE_OPTIONS: TileOptions = {
  paper: 'fit',
  orientation: 'landscape',
  scale: 'width',
}

const MM = 96 / 25.4 // CSS-pikseliä millimetrissä
const PAGE_MARGIN_MM = 10

const PAPER_MM: Record<'A4' | 'A3', [number, number]> = { A4: [210, 297], A3: [297, 420] }

/** Tulostettavan alueen koko CSS-pikseleinä (sivu miinus marginaalit). */
export function printableArea(paper: 'A4' | 'A3', orientation: Orientation) {
  const [w, h] = PAPER_MM[paper]
  const [pw, ph] = orientation === 'landscape' ? [h, w] : [w, h]
  return {
    width: Math.floor((pw - 2 * PAGE_MARGIN_MM) * MM),
    // Hieman pienempi korkeus, ettei sivu vuoda ylimääräiselle sivulle
    height: Math.floor((ph - 2 * PAGE_MARGIN_MM) * MM) - 2,
  }
}

interface TilePlan {
  /** Kuvan koko tulosteessa. */
  scale: number
  scaledWidth: number
  scaledHeight: number
  tileWidth: number
  tileHeight: number
  cols: number
  rows: number
}

/** Laskee, kuinka moneen ruutuun kuva jakautuu. Kuvan koko on SVG:n width ja height pikseleinä. */
export function planTiles(width: number, height: number, opts: TileOptions): TilePlan | null {
  if (opts.paper === 'fit' || width <= 0 || height <= 0) return null
  const area = printableArea(opts.paper, opts.orientation)
  // Sovita leveys: pieni kuva ei suurennu yli 1,5-kertaiseksi
  const scale = opts.scale === 'width' ? Math.min(area.width / width, 1.5) : 1
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  return {
    scale,
    scaledWidth,
    scaledHeight,
    tileWidth: area.width,
    tileHeight: area.height,
    cols: Math.max(1, Math.ceil(scaledWidth / area.width - 1e-6)),
    rows: Math.max(1, Math.ceil(scaledHeight / area.height - 1e-6)),
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** Rakentaa tulostettavan HTML:n: yksi ruutu per sivu, sivunumero ja sarake-rivi-merkintä kulmassa. */
export function buildTiledHtml(svg: string, title: string, opts: TileOptions): string | null {
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)
  if (!m) return null
  const plan = planTiles(Number(m[1]), Number(m[2]), opts)
  if (!plan) return null
  // Skaalataan kuva muuttamalla juurielementin mitat (viewBox pitää sisällön suhteessa)
  const scaled = svg.replace(
    /width="\d+" height="\d+"/,
    `width="${Math.round(plan.scaledWidth)}" height="${Math.round(plan.scaledHeight)}"`,
  )
  const total = plan.cols * plan.rows
  const tiles: string[] = []
  let n = 0
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      n++
      tiles.push(
        `<section class="tile" aria-label="Sivu ${n}/${total}" style="width:${plan.tileWidth}px;height:${plan.tileHeight}px">` +
          `<div class="img" style="left:${-c * plan.tileWidth}px;top:${-r * plan.tileHeight}px;width:${Math.round(plan.scaledWidth)}px;height:${Math.round(plan.scaledHeight)}px">${scaled}</div>` +
          `<span class="mark">Sivu ${n}/${total} (rivi ${r + 1}, sarake ${c + 1})</span></section>`,
      )
    }
  }
  const size = `${opts.paper} ${opts.orientation}`
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:${size};margin:${PAGE_MARGIN_MM}mm}
html,body{margin:0;background:#fff}
.tile{position:relative;overflow:hidden;page-break-after:always;break-after:page;outline:1px dashed #bbb;outline-offset:-1px}
.tile:last-child{page-break-after:auto;break-after:auto}
.img{position:absolute}
.img svg{display:block}
.mark{position:absolute;right:6px;bottom:4px;font:10px system-ui,sans-serif;color:#888;background:#fffc;padding:0 3px}
</style></head><body>${tiles.join('')}</body></html>`
}
