import { newId } from './ids'
import type { Operation } from './operations'
import type { Project, Question } from './types'

/**
 * Katselmointipalaute. Interaktiivisen HTML-tiedoston palautetilassa lukija kommentoi vaiheita ja vastaa
 * avoimiin kysymyksiin, ja tiedosto tallennetaan palautteena, joka tuodaan takaisin sovellukseen.
 */

const FEEDBACK_APP_ID = 'prosessikartta-palaute'
const MAX_ITEMS = 500
const MAX_TEXT = 4000

interface FeedbackItem {
  id: string
  type: 'comment' | 'answer'
  nodeId?: string
  nodeLabel?: string
  questionKey?: string
  questionText?: string
  text: string
}

export interface Feedback {
  app: typeof FEEDBACK_APP_ID
  version: 1
  projectId: string
  projectName: string
  reviewer: string
  createdAt: number
  items: FeedbackItem[]
}

export class FeedbackError extends Error {}

const str = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Jäsentää ja siivoaa palautetiedoston. Tuntematon tai vioittunut rakenne antaa virheen. */
export function parseFeedback(text: string): Feedback {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new FeedbackError('Tiedosto ei ole kelvollista JSONia')
  }
  const d = data as Partial<Feedback> | null
  if (!d || typeof d !== 'object' || d.app !== FEEDBACK_APP_ID || !Array.isArray(d.items))
    throw new FeedbackError('Tiedosto ei ole Prosessikartan palautetiedosto')
  const projectId = str(d.projectId, 200)
  if (!projectId) throw new FeedbackError('Palautteesta puuttuu projektin tunniste')
  const items: FeedbackItem[] = []
  for (const raw of d.items.slice(0, MAX_ITEMS) as Partial<FeedbackItem>[]) {
    const t = str(raw?.text)
    const type = raw?.type === 'answer' ? 'answer' : raw?.type === 'comment' ? 'comment' : undefined
    if (!t || !type) continue
    items.push({
      id: str(raw.id, 100) ?? `i${items.length}`,
      type,
      nodeId: str(raw.nodeId, 200),
      nodeLabel: str(raw.nodeLabel, 200),
      questionKey: str(raw.questionKey, 300),
      questionText: str(raw.questionText, 500),
      text: t,
    })
  }
  return {
    app: FEEDBACK_APP_ID,
    version: 1,
    projectId,
    projectName: str(d.projectName, 200) ?? '',
    reviewer: str(d.reviewer, 100) ?? '',
    createdAt: typeof d.createdAt === 'number' && Number.isFinite(d.createdAt) ? d.createdAt : 0,
    items,
  }
}

const keyOf = (fb: Feedback, item: FeedbackItem) => `fb:${fb.createdAt}:${fb.reviewer}:${item.id}`

/** Palauteriveistä tulee omia kysymyksiä (avoimia), joihin laatija vastaa tai jotka hän hylkää. Tuonti on idempotentti. */
function feedbackQuestions(
  project: Project,
  fb: Feedback,
  accepted: ReadonlySet<string>,
): Question[] {
  const existing = new Set(Object.values(project.questions).map((q) => q.key))
  const who = fb.reviewer || 'nimetön'
  const out: Question[] = []
  for (const item of fb.items) {
    if (!accepted.has(item.id)) continue
    const key = keyOf(fb, item)
    if (existing.has(key)) continue
    const node = item.nodeId ? project.nodes[item.nodeId] : undefined
    const text =
      item.type === 'answer'
        ? `${item.questionText ?? 'Kysymys'}\nVastaus (${who}): ${item.text}`
        : `Palaute${node || item.nodeLabel ? ` vaiheesta “${node?.label ?? item.nodeLabel}”` : ''} (${who}): ${item.text}`
    out.push({
      id: newId('q'),
      processId: node?.processId ?? project.rootProcessId,
      ...(node ? { targetId: node.id } : {}),
      rule: 'custom',
      text,
      status: 'open',
      key,
    })
  }
  return out
}

export function feedbackOps(
  project: Project,
  fb: Feedback,
  accepted: ReadonlySet<string>,
): Operation[] {
  return feedbackQuestions(project, fb, accepted).map((question) => ({
    type: 'addQuestion' as const,
    question,
  }))
}
