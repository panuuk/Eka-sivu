import { beforeEach, describe, expect, it } from 'vitest'
import { createNode } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { projectToJson } from '../model/serialize'
import { listProjects, loadProject, resetDbForTests } from '../storage/db'
import { useStore } from './store'

let n = 0
beforeEach(async () => {
  useDeterministicIds(false)
  resetDbForTests(`test-${++n}`)
  useStore.setState({
    ready: false,
    project: null,
    past: [],
    future: [],
    saveStatus: 'idle',
    error: null,
  })
  await useStore.getState().init()
})

const addNode = (label: string, key?: string) => {
  const s = useStore.getState()
  s.dispatch(
    { type: 'addNode', node: createNode(s.currentProcessId, { label }) },
    key ? { coalesceKey: key } : {},
  )
}

describe('store', () => {
  it('luo ensimmäisen projektin ja tallentaa sen', async () => {
    const s = useStore.getState()
    expect(s.ready).toBe(true)
    expect(s.project?.name).toBe('Ensimmäinen projekti')
    expect((await listProjects()).length).toBe(1)
  })

  it('kumoa ja tee uudelleen', () => {
    addNode('A')
    addNode('B')
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(2)
    useStore.getState().undo()
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(1)
    useStore.getState().undo()
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(0)
    useStore.getState().redo()
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(1)
    addNode('C') // uusi muutos tyhjentää redo-pinon
    expect(useStore.getState().future).toHaveLength(0)
  })

  it('yhdistää saman avaimen peräkkäiset muutokset yhdeksi askeleeksi', () => {
    addNode('A')
    const id = Object.keys(useStore.getState().project!.nodes)[0]
    for (const l of ['Ab', 'Abc', 'Abcd']) {
      useStore
        .getState()
        .dispatch({ type: 'updateNode', id, patch: { label: l } }, { coalesceKey: `label:${id}` })
    }
    expect(useStore.getState().project!.nodes[id].label).toBe('Abcd')
    useStore.getState().undo()
    expect(useStore.getState().project!.nodes[id].label).toBe('A')
  })

  it('virheellinen operaatio ei muuta tilaa ja asettaa virheen', () => {
    const before = useStore.getState().project
    const ok = useStore.getState().dispatch({ type: 'deleteNode', id: 'puuttuu' })
    expect(ok).toBe(false)
    expect(useStore.getState().project).toBe(before)
    expect(useStore.getState().error).toMatch(/ei löydy/)
  })

  it('poistaa valinnan solmuilta, jotka eivät enää ole olemassa', () => {
    addNode('A')
    const id = Object.keys(useStore.getState().project!.nodes)[0]
    useStore.getState().select({ nodeIds: [id] })
    useStore.getState().undo()
    expect(useStore.getState().selection.nodeIds).toEqual([])
  })

  it('tallentaa muutokset ja lataa ne uudelleen', async () => {
    addNode('Säilyvä')
    await useStore.getState().flushSave()
    const id = useStore.getState().project!.id
    const loaded = await loadProject(id)
    expect(Object.values(loaded!.nodes).map((x) => x.label)).toEqual(['Säilyvä'])
    // uusi "istunto"
    useStore.setState({ ready: false, project: null })
    await useStore.getState().init()
    expect(Object.values(useStore.getState().project!.nodes).map((x) => x.label)).toEqual([
      'Säilyvä',
    ])
  })

  it('useita projekteja: luonti, vaihto ja poisto', async () => {
    const first = useStore.getState().project!.id
    await useStore.getState().createProject('Toinen')
    expect(useStore.getState().project!.name).toBe('Toinen')
    expect(useStore.getState().projects).toHaveLength(2)
    await useStore.getState().openProject(first)
    expect(useStore.getState().project!.id).toBe(first)
    await useStore.getState().deleteProject(first)
    expect(useStore.getState().projects).toHaveLength(1)
    expect(useStore.getState().project!.name).toBe('Toinen')
  })

  it('tuonti ei ylikirjoita olemassa olevaa projektia', async () => {
    addNode('Alkuperäinen')
    await useStore.getState().flushSave()
    const text = projectToJson(useStore.getState().project!)
    await useStore.getState().importProjectJson(text)
    expect(useStore.getState().projects).toHaveLength(2)
    expect(useStore.getState().project!.name).toMatch(/tuotu/)
  })

  it('virheellinen tuonti ei vaihda projektia', async () => {
    const id = useStore.getState().project!.id
    await useStore.getState().importProjectJson('{"app":"muu"}')
    expect(useStore.getState().project!.id).toBe(id)
    expect(useStore.getState().error).toBeTruthy()
  })
})
