/**
 * Ohut kääre File System Access API:lle (Chrome, Edge). Tyypit määritellään tässä, koska
 * TypeScriptin DOM-kirjasto ei sisällä kaikkea tarvittavaa.
 */

type Mode = { mode: 'readwrite' }
type PermissionState = 'granted' | 'denied' | 'prompt'

interface WritableStream {
  write(data: string): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

export interface FileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableStream>
  queryPermission(d: Mode): Promise<PermissionState>
  requestPermission(d: Mode): Promise<PermissionState>
}

interface PickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandle[]>
}

const FILE_TYPES = [
  {
    description: 'Prosessikartta-projekti (JSON)',
    accept: { 'application/json': ['.json'] },
  },
]

export function fileAccessSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as PickerWindow
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function'
}

/** Käyttäjän peruutus ei ole virhe. */
function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

export async function pickSaveFile(suggestedName: string): Promise<FileHandle | null> {
  const w = window as unknown as PickerWindow
  try {
    return (await w.showSaveFilePicker!({ suggestedName, types: FILE_TYPES })) ?? null
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

export async function pickOpenFile(): Promise<FileHandle | null> {
  const w = window as unknown as PickerWindow
  try {
    const [handle] = await w.showOpenFilePicker!({ types: FILE_TYPES, multiple: false })
    return handle ?? null
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

/** Onko kirjoitusoikeus voimassa ilman käyttäjän vahvistusta? */
export async function hasWritePermission(handle: FileHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** Pyytää kirjoitusoikeutta. Toimii vain käyttäjän klikkauksesta. */
export async function requestWritePermission(handle: FileHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** Kirjoittaa kokonaan tai ei lainkaan: virhetilanteessa vanha sisältö jää tiedostoon. */
export async function writeTextFile(handle: FileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(text)
    await writable.close()
  } catch (e) {
    await writable.abort?.().catch(() => undefined)
    throw e
  }
}

export async function readTextFile(handle: FileHandle): Promise<string> {
  return (await handle.getFile()).text()
}
