import { analyze } from '../analysis/analyze'
import { workerRunner } from '../layout/runner'
import { descendantProcessIds } from '../model/operations'
import type { Project } from '../model/types'
import { useUi, type PresentOptions } from '../store/ui'
import { toBpmn } from './bpmn'
import { buildDocumentHtml } from './document'
import { downloadBlob, downloadText, safeFilename } from './download'
import { buildRenderGraph, type RenderGraph, type RenderOptions } from './graph'
import { toMermaid } from './mermaid'
import { printHtml } from './print'
import { renderSvg, type SvgOptions } from './svg'
import type { Theme } from './theme'

/** Vientien käyttöliittymäpuolen ajurit: laskevat asettelun työssä ja käynnistävät lataukset tai tulostuksen. */

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'mermaid' | 'bpmn' | 'html' | 'document'

export const FORMATS: { id: ExportFormat; label: string; hint: string; ext: string }[] = [
  {
    id: 'svg',
    label: 'SVG-kuva',
    hint: 'Vektorikuva, skaalautuu häviöttä. Sopii dokumentteihin ja esityksiin.',
    ext: 'svg',
  },
  {
    id: 'png',
    label: 'PNG-kuva',
    hint: 'Rasterikuva (2× tarkkuus). Sopii sähköposteihin ja diaesityksiin.',
    ext: 'png',
  },
  {
    id: 'pdf',
    label: 'PDF (kaavio)',
    hint: 'Avaa tulostusikkunan: valitse “Tallenna PDF:ksi”.',
    ext: 'pdf',
  },
  {
    id: 'document',
    label: 'Prosessidokumentti',
    hint: 'Kaavio, vaihetaulukko ja vastuumatriisi. Tulosta PDF:ksi tai lataa HTML:nä.',
    ext: 'html',
  },
  {
    id: 'html',
    label: 'HTML-tiedosto',
    hint: 'Itsenäinen, vain luettava tiedosto, jonka voi lähettää kenelle tahansa.',
    ext: 'html',
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    hint: 'Tekstimuotoinen kaavio wikeihin ja GitHubiin.',
    ext: 'mmd',
  },
  {
    id: 'bpmn',
    label: 'BPMN 2.0 XML',
    hint: 'Avautuu muissa prosessityökaluissa (esim. bpmn.io).',
    ext: 'bpmn',
  },
]

export interface ExportRequest {
  project: Project
  processId: string
  theme: Theme
  options: PresentOptions
  direction: 'DOWN' | 'RIGHT'
}

export function renderOptions(
  req: ExportRequest,
  overrides: Partial<RenderOptions> = {},
): RenderOptions {
  return {
    processId: req.processId,
    expand: req.options.expand,
    onlyConfirmed: req.options.onlyConfirmed,
    direction: req.direction,
    ...overrides,
  }
}

export function svgOptions(req: ExportRequest, title: string): SvgOptions {
  return {
    theme: req.theme,
    showRoles: req.options.showRoles,
    showSystems: req.options.showSystems,
    showUncertainty: req.options.showUncertainty,
    title,
  }
}

export async function buildGraph(
  req: ExportRequest,
  overrides: Partial<RenderOptions> = {},
): Promise<RenderGraph> {
  return buildRenderGraph(req.project, renderOptions(req, overrides), workerRunner)
}

export async function buildSvg(req: ExportRequest): Promise<string> {
  const name = req.project.processes[req.processId]?.name ?? 'Prosessi'
  return renderSvg(await buildGraph(req), svgOptions(req, name))
}

/** Rasteroi SVG:n PNG-kuvaksi selaimessa. */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  const width = Number(el.getAttribute('width')) || 800
  const height = Number(el.getAttribute('height')) || 600
  // Selaimet rajoittavat canvasin kokoa: pienennä tarvittaessa
  const maxSide = 8192
  const s = Math.min(scale, maxSide / Math.max(width, height))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Kuvan piirtäminen epäonnistui'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * s)
    canvas.height = Math.ceil(height * s)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas ei ole käytettävissä')
    ctx.scale(s, s)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG-muunnos epäonnistui'))),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Dokumentti: jokaiselle alipuun prosessille oma kaavio (ei avattuja alaprosesseja, ne ovat omina osioinaan). */
export async function buildDocument(
  req: ExportRequest,
  opts: { interactive: boolean; includeQuestions: boolean },
): Promise<string> {
  const svgs: Record<string, string> = {}
  for (const id of descendantProcessIds(req.project, req.processId)) {
    const name = req.project.processes[id]?.name ?? 'Prosessi'
    svgs[id] = renderSvg(
      await buildGraph(req, { processId: id, expand: false }),
      svgOptions(req, name),
    )
  }
  const analysis = analyze(req.project)
  return buildDocumentHtml(req.project, {
    processId: req.processId,
    theme: req.theme,
    svgs,
    interactive: opts.interactive,
    includeQuestions: opts.includeQuestions,
    questions: analysis.open,
  })
}

/** Suorittaa viennin: lataa tiedoston tai avaa tulostusikkunan. */
export async function runExport(
  format: ExportFormat,
  req: ExportRequest,
  extra: { includeQuestions?: boolean } = {},
): Promise<void> {
  const base = safeFilename(req.project.processes[req.processId]?.name ?? 'prosessi')
  switch (format) {
    case 'svg':
      return downloadText(await buildSvg(req), `${base}.svg`, 'image/svg+xml;charset=utf-8')
    case 'png':
      return downloadBlob(await svgToPng(await buildSvg(req)), `${base}.png`)
    case 'pdf': {
      const svg = await buildSvg(req)
      const name = req.project.processes[req.processId]?.name ?? 'Prosessi'
      printHtml(
        `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${name.replace(/[<&]/g, '')}</title><style>@page{size:auto;margin:12mm}body{margin:0;background:#fff}svg{max-width:100%;height:auto;display:block}</style></head><body>${svg}</body></html>`,
      )
      return
    }
    case 'mermaid':
      return downloadText(
        toMermaid(req.project, req.processId, {
          expand: req.options.expand,
          direction: req.direction === 'DOWN' ? 'TD' : 'LR',
        }) + '\n',
        `${base}.mmd`,
      )
    case 'bpmn': {
      const layout = await buildGraph(req, { expand: true, onlyConfirmed: false })
      return downloadText(
        toBpmn(req.project, req.processId, layout),
        `${base}.bpmn`,
        'application/xml;charset=utf-8',
      )
    }
    case 'html':
      return downloadText(
        await buildDocument(req, { interactive: true, includeQuestions: false }),
        `${base}.html`,
        'text/html;charset=utf-8',
      )
    case 'document': {
      printHtml(
        await buildDocument(req, {
          interactive: false,
          includeQuestions: !!extra.includeQuestions,
        }),
      )
      return
    }
  }
}

/** Tekstimuotoinen esikatselu muotoihin, joilla on sellainen. */
export async function previewText(
  format: ExportFormat,
  req: ExportRequest,
): Promise<string | null> {
  if (format === 'mermaid')
    return toMermaid(req.project, req.processId, {
      expand: req.options.expand,
      direction: req.direction === 'DOWN' ? 'TD' : 'LR',
    })
  if (format === 'bpmn')
    return toBpmn(
      req.project,
      req.processId,
      await buildGraph(req, { expand: true, onlyConfirmed: false }),
    )
  return null
}

export function currentRequest(project: Project, processId: string): ExportRequest {
  const ui = useUi.getState()
  return { project, processId, theme: ui.theme, options: ui.present, direction: ui.direction }
}
