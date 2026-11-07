import type { Product } from '../types'

const labels = ['', 'vaalea', 'keskipaahto', 'tumma', 'erittäin tumma']

export function RoastMeter({ roast }: { roast: Product['roast'] }) {
  return (
    <span className="roast" title={`Paahtoaste ${roast}/4 (${labels[roast]})`}>
      <span className="sr-only">Paahtoaste {roast}/4</span>
      {[1, 2, 3, 4].map((level) => (
        <span
          key={level}
          aria-hidden="true"
          className={`roast__bean${level <= roast ? ' roast__bean--on' : ''}`}
        />
      ))}
    </span>
  )
}
