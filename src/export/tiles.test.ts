import { describe, expect, it } from 'vitest'
import { buildTiledHtml, planTiles, printableArea } from './tiles'

describe('tulostusruudut', () => {
  it('tulostettava alue on sivu miinus marginaalit', () => {
    const a4 = printableArea('A4', 'landscape')
    // 297 - 20 = 277 mm ≈ 1047 px; 210 - 20 = 190 mm ≈ 718 px
    expect(a4.width).toBeGreaterThan(1040)
    expect(a4.width).toBeLessThan(1050)
    expect(a4.height).toBeGreaterThan(710)
    expect(a4.height).toBeLessThan(720)
    const a3 = printableArea('A3', 'portrait')
    expect(a3.width).toBeGreaterThan(1000)
    expect(a3.height).toBeGreaterThan(1500)
  })

  it('"sovita yhdelle sivulle" ei tee ruutuja', () => {
    expect(
      planTiles(3000, 2000, { paper: 'fit', orientation: 'landscape', scale: 'actual' }),
    ).toBeNull()
  })

  it('100 %: jakaa kuvan ruudukkoon kokonaisluvuin', () => {
    const plan = planTiles(3000, 2000, { paper: 'A4', orientation: 'landscape', scale: 'actual' })!
    expect(plan.scale).toBe(1)
    expect(plan.cols).toBe(3)
    expect(plan.rows).toBe(3)
    // pieni kuva mahtuu yhteen sivuun
    const small = planTiles(500, 400, { paper: 'A4', orientation: 'landscape', scale: 'actual' })!
    expect([small.cols, small.rows]).toEqual([1, 1])
  })

  it('sovita leveys: kuva skaalataan sivun leveyteen ja vain korkeus jakautuu', () => {
    const plan = planTiles(2000, 6000, { paper: 'A4', orientation: 'portrait', scale: 'width' })!
    expect(plan.cols).toBe(1)
    expect(plan.rows).toBeGreaterThan(1)
    expect(plan.scaledWidth).toBeLessThanOrEqual(plan.tileWidth + 1)
    // pieni kuva ei suurennu yli 1,5-kertaiseksi
    const small = planTiles(300, 300, { paper: 'A3', orientation: 'landscape', scale: 'width' })!
    expect(small.scale).toBe(1.5)
  })

  it('A3 vaatii vähemmän sivuja kuin A4', () => {
    const o = { orientation: 'landscape' as const, scale: 'actual' as const }
    const a4 = planTiles(4000, 3000, { paper: 'A4', ...o })!
    const a3 = planTiles(4000, 3000, { paper: 'A3', ...o })!
    expect(a3.cols * a3.rows).toBeLessThan(a4.cols * a4.rows)
  })

  it('HTML sisältää yhden ruudun per sivu ja sivumerkinnät, ja otsikko on escapettu', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2500 1500" width="2500" height="1500"><rect/></svg>'
    const html = buildTiledHtml(svg, '<script>x</script>', {
      paper: 'A4',
      orientation: 'landscape',
      scale: 'actual',
    })!
    const tiles = html.match(/class="tile"/g)!.length
    expect(tiles).toBe(3 * 3) // 2500/1047 -> 3, 1500/718 -> 3
    expect(html).toContain('Sivu 9/9')
    expect(html).toContain('@page{size:A4 landscape')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&#60;script&#62;')
  })

  it('palauttaa null, kun tiedostosta ei saa kokoa tai sovitus yhdelle sivulle', () => {
    expect(
      buildTiledHtml('<svg></svg>', 't', {
        paper: 'A4',
        orientation: 'landscape',
        scale: 'actual',
      }),
    ).toBeNull()
    expect(
      buildTiledHtml('<svg width="10" height="10"></svg>', 't', {
        paper: 'fit',
        orientation: 'landscape',
        scale: 'actual',
      }),
    ).toBeNull()
  })
})
