import { describe, expect, it } from 'vitest'
import { safeFilename } from './download'

describe('safeFilename', () => {
  it('muuntaa ääkköset ja poistaa erikoismerkit', () => {
    expect(safeFilename('Ensimmäinen projekti')).toBe('ensimmainen-projekti')
    expect(safeFilename('  Työ: Ostot/Myynti! ')).toBe('tyo-ostot-myynti')
    expect(safeFilename('Åland & café')).toBe('aland-cafe')
  })
  it('palauttaa oletusnimen tyhjälle', () => {
    expect(safeFilename('???')).toBe('prosessi')
  })
})
