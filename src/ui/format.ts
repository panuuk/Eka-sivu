const dateTime = new Intl.DateTimeFormat('fi-FI', { dateStyle: 'short', timeStyle: 'short' })
const timeOnly = new Intl.DateTimeFormat('fi-FI', { timeStyle: 'short' })

export const formatDateTime = (ts: number) => dateTime.format(ts)
export const formatTime = (ts: number) => timeOnly.format(ts)

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} t`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kt`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mt`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} Gt`
}

/** “5 minuuttia sitten”, “eilen” jne. */
export function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'juuri nyt'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min sitten`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h sitten`
  const d = Math.round(h / 24)
  return d === 1 ? 'eilen' : `${d} pv sitten`
}
