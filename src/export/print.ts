/** Avaa tulostusikkunan annetulle HTML-dokumentille (käyttäjä voi tallentaa sen PDF:ksi). */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const cleanup = () => setTimeout(() => frame.remove(), 1500)
  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return cleanup()
    win.addEventListener('afterprint', cleanup)
    // Anna kuvan ja fonttien latautua ennen tulostusta
    setTimeout(() => {
      try {
        win.focus()
        win.print()
      } finally {
        cleanup()
      }
    }, 250)
  }
  frame.srcdoc = html
}
