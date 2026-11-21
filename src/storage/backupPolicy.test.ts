import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '../model/factory'
import {
  AUTO_BACKUP_INTERVAL_MS,
  KEEP_MANUAL,
  KEEP_RECENT,
  backupReminderDue,
  selectBackupsToPrune,
  shouldAutoBackup,
} from './backupPolicy'
import type { BackupMeta } from './db'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

function withNodes(count: number, updatedAt = NOW) {
  const p = createProject('X')
  for (let i = 0; i < count; i++) {
    const n = createNode(p.rootProcessId, { label: `V${i}` })
    p.nodes[n.id] = n
  }
  return { ...p, updatedAt }
}

const meta = (i: number, createdAt: number, reason: BackupMeta['reason'] = 'auto'): BackupMeta => ({
  id: `b${i}`,
  projectId: 'p',
  projectName: 'P',
  createdAt,
  projectUpdatedAt: createdAt,
  reason,
  nodeCount: 3,
})

describe('shouldAutoBackup', () => {
  it('ei kopioi tyhjää projektia', () => {
    expect(shouldAutoBackup(withNodes(0), undefined, NOW)).toBe(false)
  })
  it('ottaa ensimmäisen kopion heti', () => {
    expect(shouldAutoBackup(withNodes(1), undefined, NOW)).toBe(true)
  })
  it('ei kopioi muuttumatonta projektia', () => {
    const p = withNodes(2)
    expect(
      shouldAutoBackup(
        p,
        { createdAt: NOW - 5 * AUTO_BACKUP_INTERVAL_MS, projectUpdatedAt: p.updatedAt },
        NOW,
      ),
    ).toBe(false)
  })
  it('odottaa vähimmäisvälin', () => {
    const p = withNodes(2, NOW)
    const latest = { createdAt: NOW - AUTO_BACKUP_INTERVAL_MS + 1000, projectUpdatedAt: NOW - 5000 }
    expect(shouldAutoBackup(p, latest, NOW)).toBe(false)
    expect(shouldAutoBackup(p, { ...latest, createdAt: NOW - AUTO_BACKUP_INTERVAL_MS }, NOW)).toBe(
      true,
    )
  })
})

describe('selectBackupsToPrune', () => {
  it('ei poista mitään, kun kopioita on vähän', () => {
    const list = Array.from({ length: 5 }, (_, i) => meta(i, NOW - i * 60_000))
    expect(selectBackupsToPrune(list, NOW)).toEqual([])
  })

  it('säilyttää uusimmat ja jokaisen päivän uusimman, poistaa loput', () => {
    // 30 kopiota, 10 minuutin välein: kaikki samalta päivältä
    const sameDay = Array.from({ length: 30 }, (_, i) => meta(i, NOW - i * 10 * 60_000))
    const removed = selectBackupsToPrune(sameDay, NOW)
    expect(removed).toHaveLength(30 - KEEP_RECENT)
    expect(removed).not.toContain('b0')
    expect(removed).toContain('b29')
  })

  it('säilyttää vanhoista päivistä yhden kopion päivää kohti', () => {
    const recent = Array.from({ length: KEEP_RECENT }, (_, i) => meta(i, NOW - i * 60_000))
    const old = [
      meta(100, NOW - 3 * DAY),
      meta(101, NOW - 3 * DAY - 3600_000),
      meta(102, NOW - 5 * DAY),
      meta(103, NOW - 40 * DAY),
    ]
    const removed = selectBackupsToPrune([...recent, ...old], NOW)
    expect(removed).not.toContain('b100')
    expect(removed).toContain('b101')
    expect(removed).not.toContain('b102')
    expect(removed).toContain('b103') // yli KEEP_DAYS vanha
  })

  it('käsin otettuja kopioita ei poisteta automaattikopioiden perusteella', () => {
    const manual = meta(500, NOW - 100 * DAY, 'manual')
    const auto = Array.from({ length: 40 }, (_, i) => meta(i, NOW - i * 60_000))
    expect(selectBackupsToPrune([manual, ...auto], NOW)).not.toContain('b500')
  })

  it('rajaa käsin otetut kopiot', () => {
    const manual = Array.from({ length: KEEP_MANUAL + 3 }, (_, i) =>
      meta(i, NOW - i * 1000, 'manual'),
    )
    const removed = selectBackupsToPrune(manual, NOW)
    expect(removed).toHaveLength(3)
    expect(removed).toContain(`b${KEEP_MANUAL + 2}`)
  })
})

describe('backupReminderDue', () => {
  const base = {
    project: { ...withNodes(8, NOW - DAY), createdAt: NOW - 30 * DAY },
    lastFileBackupAt: undefined,
    linkedAndWorking: false,
    snoozedUntil: 0,
    now: NOW,
  }
  it('muistuttaa, kun kopiota ei ole koskaan otettu', () => {
    expect(backupReminderDue(base)).toBe(true)
  })
  it('ei muistuta pienestä projektista', () => {
    expect(backupReminderDue({ ...base, project: { ...base.project, nodes: {} } })).toBe(false)
  })
  it('ei muistuta tuoreen kopion jälkeen', () => {
    expect(backupReminderDue({ ...base, lastFileBackupAt: NOW - 2 * DAY })).toBe(false)
  })
  it('ei muistuta, jos mikään ei ole muuttunut kopion jälkeen', () => {
    expect(backupReminderDue({ ...base, lastFileBackupAt: NOW })).toBe(false)
  })
  it('ei muistuta toimivan tiedostoyhteyden kanssa tai torkun aikana', () => {
    expect(backupReminderDue({ ...base, linkedAndWorking: true })).toBe(false)
    expect(backupReminderDue({ ...base, snoozedUntil: NOW + 1000 })).toBe(false)
  })
})
