let counter = 0
let deterministic = false

/** Testejä varten: tuottaa ennustettavia tunnisteita. */
export function useDeterministicIds(on: boolean) {
  deterministic = on
  counter = 0
}

export function newId(prefix: string): string {
  if (deterministic) return `${prefix}_${++counter}`
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `${prefix}_${rand}`
}
