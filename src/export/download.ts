/** Käynnistää tiedoston latauksen selaimessa. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/** Tiedostonimeksi kelpaava, ASCII-muotoinen versio nimestä (ääkköset muunnetaan). */
export function safeFilename(name: string): string {
  return (
    name
      .trim()
      .toLocaleLowerCase('fi')
      .replace(/[äå]/g, 'a')
      .replace(/ö/g, 'o')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'prosessi'
  )
}
