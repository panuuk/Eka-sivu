/** Sisentää tai poistaa sisennyksen valituilta riveiltä (Tab / Shift+Tab). */
export function indentLines(
  text: string,
  selStart: number,
  selEnd: number,
  outdent: boolean,
): { text: string; start: number; end: number } {
  const INDENT = '  '
  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1
  if (!outdent && selStart === selEnd) {
    return {
      text: text.slice(0, selStart) + INDENT + text.slice(selEnd),
      start: selStart + 2,
      end: selStart + 2,
    }
  }
  const block = text.slice(lineStart, selEnd)
  let firstDelta = 0
  let total = 0
  const lines = block.split('\n').map((l, i) => {
    let next: string
    if (outdent) {
      const m = /^( {1,2}|\t)/.exec(l)
      next = m ? l.slice(m[0].length) : l
    } else {
      next = INDENT + l
    }
    const delta = next.length - l.length
    if (i === 0) firstDelta = delta
    total += delta
    return next
  })
  return {
    text: text.slice(0, lineStart) + lines.join('\n') + text.slice(selEnd),
    start: Math.max(lineStart, selStart + firstDelta),
    end: selEnd + total,
  }
}
