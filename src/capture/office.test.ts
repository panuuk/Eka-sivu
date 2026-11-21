// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  bytesToBinaryString,
  decodeMimeWords,
  emlToText,
  htmlToStructuredText,
  paragraphsOfSlideXml,
  pptxToText,
  slideToText,
} from './office'

const enc = (s: string) => bytesToBinaryString(new TextEncoder().encode(s))

async function makePptx(slides: string[][], notes: Record<number, string[]> = {}) {
  const zip = new JSZip()
  const para = (t: string) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`
  slides.forEach((paras, i) =>
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<p:sld><p:txBody>${paras.map(para).join('')}</p:txBody></p:sld>`,
    ),
  )
  for (const [n, paras] of Object.entries(notes))
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes>${paras.map(para).join('')}</p:notes>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('pptxToText', () => {
  it('lukee diat järjestyksessä muistiinpanoineen ja purkaa entiteetit', async () => {
    const data = await makePptx(
      [
        ['Hyväksyntäprosessi', 'Esimies tarkistaa &amp; hyväksyy laskun'],
        ['Toinen dia'],
        ['Kymmenes'],
      ],
      { 1: ['Muista mainita raja', '1'] },
    )
    const text = await pptxToText(data)
    expect(text.indexOf('Dia 1')).toBeLessThan(text.indexOf('Dia 2'))
    expect(text).toContain('Esimies tarkistaa & hyväksyy laskun')
    expect(text).toContain('Muistiinpanot:\nMuista mainita raja')
    expect(text).not.toContain('\n1\n') // muistiinpanosivun numerokenttä pois
  })

  it('järjestää diat numeron, ei aakkosten mukaan', async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Sisältö ${i + 1}`])
    const text = await pptxToText(await makePptx(slides))
    expect(text.indexOf('Sisältö 2')).toBeLessThan(text.indexOf('Sisältö 10'))
    expect(text.indexOf('Sisältö 9')).toBeLessThan(text.indexOf('Sisältö 10'))
  })

  it('virhe, kun diaa ei löydy', async () => {
    const zip = new JSZip()
    zip.file('muu.txt', 'x')
    await expect(pptxToText(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      /diaa/,
    )
  })

  it('kappaleen rivinvaihdot säilyvät', () => {
    expect(
      paragraphsOfSlideXml('<a:p><a:r><a:t>A</a:t></a:r><a:br/><a:r><a:t>B</a:t></a:r></a:p>'),
    ).toEqual(['A\nB'])
  })
})

describe('emlToText', () => {
  it('yksinkertainen UTF-8-viesti', () => {
    const raw = enc(
      'From: Matti <matti@example.com>\r\nTo: Liisa <liisa@example.com>\r\nSubject: Laskun hyväksyntä\r\nDate: Mon, 1 Jan 2024 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHei,\r\nEsimies hyväksyy laskun.',
    )
    const m = emlToText(raw)
    expect(m.subject).toBe('Laskun hyväksyntä')
    expect(m.text).toContain('Lähettäjä: Matti')
    expect(m.text).toContain('Esimies hyväksyy laskun.')
  })

  it('RFC 2047 -otsikot (B ja Q) ja quoted-printable ISO-8859-1', () => {
    expect(decodeMimeWords('=?UTF-8?B?TMOkaGV0w6QgbGFza3U=?=')).toBe('Lähetä lasku')
    expect(decodeMimeWords('=?ISO-8859-1?Q?H=E4t=E4?=')).toBe('Hätä')
    const raw =
      'Subject: =?ISO-8859-1?Q?Tarkistus_=E4=E4?=\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nP=E4=E4t=F6s tehd=E4=E4n =\r\nhuomenna.'
    const m = emlToText(raw)
    expect(m.subject).toBe('Tarkistus ää')
    expect(m.text).toContain('Päätös tehdään huomenna.')
  })

  it('multipart: valitsee text/plain-osan ja ohittaa liitteet', () => {
    const raw = [
      'Subject: Testi',
      'Content-Type: multipart/mixed; boundary="B1"',
      '',
      '--B1',
      'Content-Type: multipart/alternative; boundary="B2"',
      '',
      '--B2',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Päätös: hyväksytään.').toString('base64'),
      '--B2',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML-versio</p>',
      '--B2--',
      '--B1',
      'Content-Type: application/pdf; name="x.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQ=',
      '--B1--',
    ].join('\r\n')
    const m = emlToText(raw)
    expect(m.text).toContain('Päätös: hyväksytään.')
    expect(m.text).not.toContain('HTML-versio')
    expect(m.text).not.toContain('JVBER')
  })

  it('pelkkä HTML-viesti siivotaan merkinnöistä', () => {
    const raw = enc(
      'Subject: H\r\nContent-Type: text/html\r\n\r\n<style>p{}</style><p>Kirjaa lasku&nbsp;ERPiin</p><br>Valmis &amp; lähetetty',
    )
    const m = emlToText(raw)
    expect(m.text).toContain('Kirjaa lasku ERPiin')
    expect(m.text).toContain('Valmis & lähetetty')
    expect(m.text).not.toContain('<p>')
  })
})

describe('slideToText', () => {
  const sp = (ph: string, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paras
      .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
      .join('')}</p:txBody></p:sp>`
  const cell = (t: string) =>
    `<a:tc><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`

  it('otsikko otsikoksi, sisältökentän kappaleet luetteloksi ja taulukko riveiksi', () => {
    const xml =
      sp('<p:ph type="title"/>', ['Hyväksyntä']) +
      sp('<p:ph idx="1"/>', ['Esimies tarkistaa laskun.', 'Talous maksaa.']) +
      sp('', ['Vapaa tekstilaatikko']) +
      `<p:graphicFrame><a:tbl><a:tr>${cell('Vaihe')}${cell('Rooli')}</a:tr><a:tr>${cell('Maksu')}${cell('Talous')}</a:tr></a:tbl></p:graphicFrame>`
    expect(slideToText(xml, 2)).toEqual([
      '## Hyväksyntä',
      '- Esimies tarkistaa laskun.',
      '- Talous maksaa.',
      'Vapaa tekstilaatikko',
      '| Vaihe | Rooli |',
      '| Maksu | Talous |',
    ])
  })

  it('ilman otsikkoa dian numero on otsikkona', () => {
    expect(slideToText(sp('', ['Teksti']), 3)).toEqual(['## Dia 3', 'Teksti'])
  })
})

describe('htmlToStructuredText', () => {
  const parse = (h: string) => new DOMParser().parseFromString(h, 'text/html')
  it('otsikot, luettelot, numeroidut luettelot ja taulukot säilyvät', () => {
    const html =
      '<h1>Prosessi</h1><p>Johdanto.</p><h2>Vaiheet</h2><ol><li>Kirjaa <strong>lasku</strong></li><li>Hyväksy<ul><li>esimies</li></ul></li></ol>' +
      '<table><tr><th>Vaihe</th><th>Rooli</th></tr><tr><td>Maksu</td><td>Talous</td></tr></table>'
    expect(htmlToStructuredText(html, parse)).toBe(
      [
        '# Prosessi',
        '',
        'Johdanto.',
        '',
        '## Vaiheet',
        '',
        '1. Kirjaa lasku',
        '2. Hyväksy',
        '  - esimies',
        '',
        '| Vaihe | Rooli |',
        '| Maksu | Talous |',
      ].join('\n'),
    )
  })
})
