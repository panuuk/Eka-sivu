import { themeColors, sanitizeTheme, type Theme } from './theme'
import type { DeckSlide } from './deck'

/** Slaidin mitat (LAYOUT_WIDE, 16:9) tuumina. */
const SLIDE_W = 13.333
const SLIDE_H = 7.5
const MARGIN = 0.45
const TITLE_H = 0.85

const hex = (c: string) => c.replace('#', '').toUpperCase()

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      // pptxgenjs odottaa muodon "image/png;base64,...", ilman "data:"-etuliitettä
      resolve(url.replace(/^data:/, ''))
    }
    r.onerror = () => reject(new Error('Kuvan lukeminen epäonnistui'))
    r.readAsDataURL(blob)
  })
}

/** Sovittaa kuvan laatikkoon suhteen säilyttäen ja keskittäen. */
function fitBox(
  imgW: number,
  imgH: number,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const s = Math.min(box.w / imgW, box.h / imgH)
  const w = imgW * s
  const h = imgH * s
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

interface PptxMeta {
  title: string
  theme: Theme
  /** SVG -> PNG -rasteroija (selaimessa `svgToPng`). */
  rasterize: (svg: string) => Promise<Blob>
}

/** Kirjoittaa diasuunnitelman .pptx-tiedostoksi. pptxgenjs ladataan vasta tarvittaessa. */
export async function buildPptx(slides: DeckSlide[], meta: PptxMeta): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const theme = sanitizeTheme(meta.theme)
  const c = themeColors(theme)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = meta.title
  pptx.author = 'Prosessikartta'
  pptx.company = ''
  pptx.subject = 'Prosessikuvaus'

  const font = 'Calibri'
  const bg = hex(c.bg)
  const text = hex(c.text)
  const muted = hex(c.muted)
  const accent = hex(c.accent)

  const addTitle = (slide: ReturnType<typeof pptx.addSlide>, title: string) => {
    slide.addText(title, {
      x: MARGIN,
      y: 0.25,
      w: SLIDE_W - 2 * MARGIN,
      h: TITLE_H,
      fontFace: font,
      fontSize: 26,
      bold: true,
      color: text,
      valign: 'middle',
      fit: 'shrink',
    })
    slide.addShape('rect', {
      x: MARGIN,
      y: 0.25 + TITLE_H,
      w: 1.2,
      h: 0.05,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    })
  }

  for (const s of slides) {
    const slide = pptx.addSlide()
    slide.background = { color: bg }

    if (s.kind === 'title') {
      slide.addText(s.title, {
        x: 0.8,
        y: 2.3,
        w: SLIDE_W - 1.6,
        h: 1.4,
        fontFace: font,
        fontSize: 44,
        bold: true,
        color: text,
        valign: 'bottom',
        fit: 'shrink',
      })
      slide.addShape('rect', {
        x: 0.8,
        y: 3.85,
        w: 2.2,
        h: 0.08,
        fill: { color: accent },
        line: { color: accent, width: 0 },
      })
      slide.addText(s.subtitle, {
        x: 0.8,
        y: 4.05,
        w: SLIDE_W - 1.6,
        h: 0.6,
        fontFace: font,
        fontSize: 20,
        color: muted,
        valign: 'top',
      })
    } else if (s.kind === 'diagram') {
      addTitle(slide, s.title)
      const png = await meta.rasterize(s.svg)
      const data = await blobToBase64(png)
      const top = 0.25 + TITLE_H + 0.2
      const sideW = s.side ? 3.6 : 0
      const box = {
        x: MARGIN,
        y: top,
        w: SLIDE_W - 2 * MARGIN - (sideW ? sideW + 0.25 : 0),
        h: SLIDE_H - top - 0.55,
      }
      const f = fitBox(s.width || 1, s.height || 1, box)
      slide.addImage({ data, x: f.x, y: f.y, w: f.w, h: f.h, altText: s.title })
      if (s.side) {
        slide.addText(
          s.side.map((line) => ({ text: line, options: { breakLine: true } })),
          {
            x: SLIDE_W - MARGIN - sideW,
            y: top,
            w: sideW,
            h: box.h,
            fontFace: font,
            fontSize: 14,
            color: text,
            valign: 'top',
            paraSpaceAfter: 6,
            fit: 'shrink',
            fill: { color: hex(c.surface2) },
            margin: 0.15,
          },
        )
      }
      if (s.caption) {
        slide.addText(s.caption, {
          x: MARGIN,
          y: SLIDE_H - 0.5,
          w: SLIDE_W - 2 * MARGIN,
          h: 0.3,
          fontFace: font,
          fontSize: 11,
          color: muted,
        })
      }
    } else if (s.kind === 'text') {
      addTitle(slide, s.title)
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: MARGIN + 0.2,
          y: 1.6,
          w: SLIDE_W - 2 * MARGIN - 0.4,
          h: SLIDE_H - 2.3,
          fontFace: font,
          fontSize: 22,
          color: text,
          valign: 'top',
          paraSpaceAfter: 12,
          fit: 'shrink',
        },
      )
    } else {
      addTitle(slide, s.title)
      const widthTotal = SLIDE_W - 2 * MARGIN
      const cols = s.header.length
      // Ensimmäinen sarake kapeampi, viimeinen leveämpi
      const weights = s.header.map((_, i) => (i === 0 ? 1 : i === cols - 1 ? 1.6 : 1.2))
      const sum = weights.reduce((a, b) => a + b, 0)
      const colW = weights.map((w) => (w / sum) * widthTotal)
      const border = { type: 'solid' as const, pt: 0.5, color: hex(c.border) }
      const rows = [
        s.header.map((h) => ({
          text: h,
          options: {
            bold: true,
            color: 'FFFFFF',
            fill: { color: accent },
            fontFace: font,
            fontSize: 14,
            border,
          },
        })),
        ...s.rows.map((r, ri) =>
          r.map((cell) => ({
            text: cell,
            options: {
              color: text,
              fontFace: font,
              fontSize: 13,
              border,
              valign: 'top' as const,
              fill: { color: ri % 2 ? hex(c.surface2) : bg },
            },
          })),
        ),
      ]
      slide.addTable(rows, { x: MARGIN, y: 1.5, w: widthTotal, colW, autoPage: false })
      if (s.caption) {
        slide.addText(s.caption, {
          x: MARGIN,
          y: SLIDE_H - 0.5,
          w: widthTotal,
          h: 0.3,
          fontFace: font,
          fontSize: 11,
          color: muted,
        })
      }
    }

    // Alatunniste ja puhujan muistiinpanot
    if (s.kind !== 'title') {
      slide.addText('Prosessikartta', {
        x: SLIDE_W - MARGIN - 2,
        y: SLIDE_H - 0.35,
        w: 2,
        h: 0.25,
        fontFace: font,
        fontSize: 9,
        color: muted,
        align: 'right',
      })
    }
    if (s.notes) slide.addNotes(s.notes)
  }

  const out = await pptx.write({ outputType: 'blob' })
  return out as Blob
}
