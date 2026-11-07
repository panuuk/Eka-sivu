import type { Chain, ChainGroup, ChainId } from '../types'

export const chains: Chain[] = [
  { id: 'prisma', name: 'Prisma', group: 'S-ryhmä' },
  { id: 's-market', name: 'S-market', group: 'S-ryhmä' },
  { id: 'sale', name: 'Sale', group: 'S-ryhmä' },
  { id: 'k-citymarket', name: 'K-Citymarket', group: 'K-ryhmä' },
  { id: 'k-supermarket', name: 'K-Supermarket', group: 'K-ryhmä' },
  { id: 'k-market', name: 'K-Market', group: 'K-ryhmä' },
  { id: 'lidl', name: 'Lidl', group: 'Lidl' },
]

export const chainGroups: ChainGroup[] = ['S-ryhmä', 'K-ryhmä', 'Lidl']

export const memberCardByGroup: Record<ChainGroup, string> = {
  'S-ryhmä': 'S-Etukortti',
  'K-ryhmä': 'Plussa',
  Lidl: 'Lidl Plus',
}

const chainMap = new Map(chains.map((chain) => [chain.id, chain]))

export function getChain(id: ChainId): Chain {
  const chain = chainMap.get(id)
  if (!chain) throw new Error(`Tuntematon ketju: ${id}`)
  return chain
}

export function chainsInGroup(group: ChainGroup): ChainId[] {
  return chains.filter((chain) => chain.group === group).map((chain) => chain.id)
}
