import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { parseProjectJson } from '../model/serialize'
import { addBackup, getFileLink, listBackups, listProjects, resetDbForTests } from '../storage/db'
import type { FileHandle } from '../storage/fileAccess'
import { useStore } from './store'
import { resetStorageStateForTests, setFileWriteDelayForTests, useStorage } from './storage'

/**
 * Muistinvarainen tiedostokahva. Tila on moduulin tasolla ja kahvassa on vain data, jotta kahva
 * voidaan tallentaa IndexedDB:hen kuten oikea.
 */
const files = new Map<
  string,
  { content: string; permission: 'granted' | 'prompt'; writes: number }
>()
let fileSeq = 0

class FakeHandle {
  readonly name = 'testi.prosessikartta.json'
  readonly key = `f${++fileSeq}`
  constructor() {
    files.set(this.key, { content: '', permission: 'granted', writes: 0 })
  }
  private get st() {
    return files.get(this.key)!
  }
  async getFile() {
    return new File([this.st.content], 'testi.json')
  }
  async createWritable() {
    if (files.get(this.key)!.content === '\u0000fail') throw new Error('levy täynnä')
    let buf = ''
    const st = this.st
    return {
      write: async (d: string) => void (buf += d),
      close: async () => {
        st.content = buf
        st.writes++
      },
      abort: async () => undefined,
    }
  }
  async queryPermission() {
    return this.st.permission
  }
  async requestPermission() {
    this.st.permission = 'granted'
    return this.st.permission
  }
}
const fake = () => new FakeHandle() as unknown as FileHandle & { key: string }
const text = (h: { key: string }) => files.get(h.key)!.content
const writes = (h: { key: string }) => files.get(h.key)!.writes
const revoke = (h: { key: string }) => void (files.get(h.key)!.permission = 'prompt')

let n = 0
beforeEach(async () => {
  useDeterministicIds(false)
  resetDbForTests(`storage-test-${++n}`)
  resetStorageStateForTests()
  setFileWriteDelayForTests(30)
  useStore.setState({
    ready: false,
    project: null,
    past: [],
    future: [],
    saveStatus: 'idle',
    error: null,
  })
  await useStore.getState().init()
  await settle()
})
/** Odottaa, että taustalla ketjutetut varmuuskopiot ja yhteyden lataus ovat valmiit. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

const addNode = (label: string) => {
  const s = useStore.getState()
  s.dispatch({ type: 'addNode', node: createNode(s.currentProcessId, { label }) })
}

describe('varmuuskopiot', () => {
  it('tyhjästä projektista ei oteta kopiota, muutoksen jälkeen otetaan', async () => {
    expect(await listBackups()).toHaveLength(0)
    addNode('A')
    await useStore.getState().flushSave()
    await settle()
    const list = await listBackups()
    expect(list).toHaveLength(1)
    expect(list[0].reason).toBe('auto')
    expect(list[0].nodeCount).toBe(1)
  })

  it('käsin otettu kopio ja palautus: nykyinen tila otetaan ensin talteen', async () => {
    addNode('A')
    await useStorage.getState().backupNow('manual')
    const [manual] = (await listBackups()).filter((b) => b.reason === 'manual')
    addNode('B')
    await useStore.getState().flushSave()
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(2)

    await useStorage.getState().restoreBackup(manual.id, 'replace')
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(1)
    const reasons = (await listBackups()).map((b) => b.reason)
    expect(reasons).toContain('before-restore')
    const before = (await listBackups()).find((b) => b.reason === 'before-restore')!
    expect(before.nodeCount).toBe(2)
  })

  it('palautus kopiona ei koske alkuperäiseen', async () => {
    addNode('A')
    await useStorage.getState().backupNow('manual')
    const [manual] = (await listBackups()).filter((b) => b.reason === 'manual')
    const origId = useStore.getState().project!.id
    await useStorage.getState().restoreBackup(manual.id, 'copy')
    const now = useStore.getState().project!
    expect(now.id).not.toBe(origId)
    expect(now.name).toMatch(/kopio/)
    expect((await listProjects()).length).toBe(2)
  })

  it('projektin poisto säilyttää viimeisen tilan varmuuskopiona', async () => {
    addNode('A')
    await useStore.getState().flushSave()
    const id = useStore.getState().project!.id
    await useStore.getState().createProject('Toinen')
    await useStore.getState().deleteProject(id)
    expect((await listProjects()).map((p) => p.id)).not.toContain(id)
    const deleted = (await listBackups(id)).filter((b) => b.reason === 'deleted')
    expect(deleted).toHaveLength(1)
    // ... ja sen voi palauttaa
    await useStorage.getState().restoreBackup(deleted[0].id, 'replace')
    expect(useStore.getState().project!.id).toBe(id)
    expect(Object.keys(useStore.getState().project!.nodes)).toHaveLength(1)
  })

  it('poistettu kopio häviää luettelosta', async () => {
    const p = useStore.getState().project!
    const meta = await addBackup(p, 'manual')
    await useStorage.getState().removeBackup(meta.id)
    expect(await listBackups()).toHaveLength(0)
  })
})

describe('tiedostoyhteys', () => {
  // Valinta tehdään saman reitin kautta kuin selaimessa: ikkunan valitsin palauttaa kahvan.
  async function linkWith(handle: FileHandle) {
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => handle,
      showOpenFilePicker: async () => [handle],
    })
    try {
      await useStorage.getState().linkToNewFile()
    } finally {
      vi.unstubAllGlobals()
    }
  }
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))
  const nodeCount = (h: { key: string }) => Object.keys(parseProjectJson(text(h)).nodes).length

  it('yhdistäminen kirjoittaa projektin heti ja tallentaa kahvan', async () => {
    addNode('A')
    const handle = fake()
    await linkWith(handle)
    expect(nodeCount(handle)).toBe(1)
    expect(useStorage.getState().fileLink?.status).toBe('ok')
    expect(await getFileLink(useStore.getState().project!.id)).toBeDefined()
    expect(useStorage.getState().lastFileBackupAt).toBeTypeOf('number')
  })

  it('muutokset kirjoitetaan tiedostoon viiveellä ja yhdistyvät yhdeksi kirjoitukseksi', async () => {
    const handle = fake()
    await linkWith(handle)
    const base = writes(handle)
    addNode('A')
    await useStore.getState().flushSave()
    addNode('B')
    await useStore.getState().flushSave()
    expect(writes(handle)).toBe(base)
    expect(useStorage.getState().fileWritePending).toBe(true)
    await wait()
    expect(writes(handle)).toBe(base + 1)
    expect(nodeCount(handle)).toBe(2)
    expect(useStorage.getState().fileWritePending).toBe(false)
  })

  it('kun lupa puuttuu, tila on needs-permission ja jatko palauttaa kirjoituksen', async () => {
    const handle = fake()
    await linkWith(handle)
    revoke(handle)
    addNode('A')
    await useStore.getState().flushSave()
    await wait()
    expect(useStorage.getState().fileLink?.status).toBe('needs-permission')
    await useStorage.getState().resumeFileLink()
    expect(useStorage.getState().fileLink?.status).toBe('ok')
    expect(nodeCount(handle)).toBe(1)
  })

  it('kirjoitusvirhe näkyy tilassa eikä kaada tallennusta', async () => {
    const handle = fake()
    await linkWith(handle)
    files.get(handle.key)!.content = '\u0000fail'
    addNode('A')
    await useStore.getState().flushSave()
    await wait()
    expect(useStorage.getState().fileLink?.status).toBe('error')
    expect(useStorage.getState().fileLink?.message).toMatch(/levy täynnä/)
    expect(useStore.getState().saveStatus).toBe('saved')
  })

  it('yhteyden katkaisu poistaa kahvan', async () => {
    await linkWith(fake())
    const id = useStore.getState().project!.id
    await useStorage.getState().unlinkFile()
    expect(useStorage.getState().fileLink).toBeNull()
    expect(await getFileLink(id)).toBeUndefined()
  })

  it('projektin vaihto kirjoittaa edellisen projektin viimeisen tilan', async () => {
    const handle = fake()
    await linkWith(handle)
    addNode('A')
    await useStore.getState().flushSave()
    await useStore.getState().createProject('Toinen')
    await wait()
    expect(nodeCount(handle)).toBe(1)
    expect(useStorage.getState().fileLink).toBeNull() // toisella projektilla ei ole yhteyttä
  })
})
