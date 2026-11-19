import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

self.onmessage = async (
  e: MessageEvent<{ id: number; graph: Parameters<typeof elk.layout>[0] }>,
) => {
  const { id, graph } = e.data
  try {
    const res = await elk.layout(graph)
    self.postMessage({ id, res })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
