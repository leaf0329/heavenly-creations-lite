import { JOB_TYPES, TEXT_JOB_TYPES, type JobType, type TextJobType } from './features'

/** The only queue used by the first HCLite release. */
export type QueueKind = 'text'

export type JobHandler = 'text' | 'stt'

export interface JobDefinition {
  queueKind: QueueKind
  handler: JobHandler
  /** Whether a local text worker can execute this type. */
  implemented: boolean
}

const JOB_DEFINITIONS: Readonly<Record<JobType, JobDefinition>> = Object.freeze({
  'topic-plan': { queueKind: 'text', handler: 'text', implemented: true },
  topics: { queueKind: 'text', handler: 'text', implemented: true },
  'stt-rewrite': { queueKind: 'text', handler: 'text', implemented: true },
  'xiaohongshu-copy': { queueKind: 'text', handler: 'text', implemented: true },
  'moments-copy': { queueKind: 'text', handler: 'text', implemented: true },
  'sales-script': { queueKind: 'text', handler: 'text', implemented: true },
  // STT is deliberately registered for the transcription worker.  The text
  // worker rejects it rather than accidentally sending audio work to a text
  // provider.
  stt: { queueKind: 'text', handler: 'stt', implemented: false },
})

export { JOB_TYPES, TEXT_JOB_TYPES }
export type { JobType, TextJobType }

export function getJobDefinition(type: string): JobDefinition | null {
  return (JOB_DEFINITIONS as Record<string, JobDefinition>)[type] || null
}

export function isRegisteredJobType(type: unknown): type is JobType {
  return typeof type === 'string' && Boolean(getJobDefinition(type))
}

export function isTextJobType(type: unknown): type is TextJobType {
  return typeof type === 'string' && (TEXT_JOB_TYPES as readonly string[]).includes(type)
}

export function isImplementedTextJobType(type: unknown): type is TextJobType {
  return isTextJobType(type) && getJobDefinition(type)?.implemented === true
}

