import type { BackupMeta } from './db'
import type { Project } from '../model/types'

/** Automaattinen varmuuskopio otetaan enintään tämän välein. */
export const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000
/** Uusimmat automaattiset kopiot säilytetään aina tähän määrään asti. */
export const KEEP_RECENT = 20
/** Lisäksi jokaisen näin monen viime päivän uusin kopio säilytetään. */
export const KEEP_DAYS = 14
/** Käsin otettuja kopioita säilytetään enintään näin monta. */
export const KEEP_MANUAL = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Pitääkö projektista ottaa automaattinen varmuuskopio nyt?
 * `latest` on projektin uusin kopio. Ensimmäinen kopio otetaan heti, kun projektissa on sisältöä.
 */
export function shouldAutoBackup(
  project: Project,
  latest: Pick<BackupMeta, 'createdAt' | 'projectUpdatedAt'> | undefined,
  now: number,
): boolean {
  if (Object.keys(project.nodes).length === 0) return false
  if (!latest) return true
  if (latest.projectUpdatedAt === project.updatedAt) return false
  return now - latest.createdAt >= AUTO_BACKUP_INTERVAL_MS
}

/** Palauttaa poistettavien kopioiden tunnisteet. `backups` ovat saman projektin kopioita. */
export function selectBackupsToPrune(backups: BackupMeta[], now: number): string[] {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt)
  const remove: string[] = []

  const auto = sorted.filter((b) => b.reason === 'auto')
  const dayOf = (b: BackupMeta) => Math.floor((now - b.createdAt) / DAY_MS)
  // Päivät, joilta uusin kopio on jo säilössä, eivät tarvitse lisäkopioita.
  const keptDays = new Set<number>(auto.slice(0, KEEP_RECENT).map(dayOf))
  auto.forEach((b, i) => {
    if (i < KEEP_RECENT) return
    const day = dayOf(b)
    if (day < KEEP_DAYS && !keptDays.has(day)) {
      keptDays.add(day)
      return
    }
    remove.push(b.id)
  })

  // Muut syyt (käsin, ennen palautusta) ovat tärkeämpiä, mutta nekin rajataan.
  const others = sorted.filter((b) => b.reason !== 'auto')
  others.slice(KEEP_MANUAL).forEach((b) => remove.push(b.id))
  return remove
}

export const REASON_LABELS: Record<BackupMeta['reason'], string> = {
  auto: 'Automaattinen',
  manual: 'Käsin otettu',
  'before-restore': 'Ennen palautusta',
  deleted: 'Poistetun projektin viimeinen tila',
}

export const REMINDER_AFTER_MS = 7 * DAY_MS
export const REMINDER_MIN_NODES = 5

/**
 * Muistutetaan tiedostovarmuuskopiosta, kun projektissa on työtä, sitä on muutettu viimeisen
 * tiedostovarmuuskopion jälkeen ja kopio on yli viikon vanha (tai puuttuu).
 */
export function backupReminderDue(args: {
  project: Pick<Project, 'nodes' | 'createdAt' | 'updatedAt'>
  lastFileBackupAt: number | undefined
  linkedAndWorking: boolean
  snoozedUntil: number
  now: number
}): boolean {
  const { project, lastFileBackupAt, linkedAndWorking, snoozedUntil, now } = args
  if (linkedAndWorking) return false
  if (Object.keys(project.nodes).length < REMINDER_MIN_NODES) return false
  if (snoozedUntil > now) return false
  const since = lastFileBackupAt ?? project.createdAt
  if (project.updatedAt <= since) return false
  return now - since > REMINDER_AFTER_MS
}
