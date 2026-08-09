import 'server-only'

import { randomUUID } from 'node:crypto'
import { query, withTransaction } from './db'
import { isRegisteredJobType, isTextJobType, type JobType } from './job-registry'

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type SourceKind = 'upload' | 'url' | 'none'

export interface JobRecord {
  id: string
  userId: string
  type: JobType
  status: JobStatus
  title: string
  input: Record<string, unknown>
  resultText: string | null
  sourceKind: SourceKind
  sourceUrl: string | null
  sourceFilename: string | null
  temporaryPath: string | null
  sourceMetadata: Record<string, unknown>
  progress: number
  progressMessage: string
  attemptCount: number
  maxAttempts: number
  retryAt: string | null
  processingToken: string | null
  leaseUntil: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface CreateJobInput {
  id?: string
  userId: string
  type: JobType
  title?: string
  input?: Record<string, unknown>
  sourceKind?: SourceKind
  sourceUrl?: string | null
  sourceFilename?: string | null
  temporaryPath?: string | null
  sourceMetadata?: Record<string, unknown>
  maxAttempts?: number
}

interface JobRow {
  id: string
  user_id: string
  type: JobType
  status: JobStatus
  title: string
  input: Record<string, unknown> | string | null
  result_text: string | null
  source_kind: SourceKind
  source_url: string | null
  source_filename: string | null
  temporary_path: string | null
  source_metadata: Record<string, unknown> | string | null
  progress: number | string
  progress_message: string
  attempt_count: number | string
  max_attempts: number | string
  retry_at: Date | string | null
  processing_token: string | null
  lease_until: Date | string | null
  error_message: string | null
  created_at: Date | string
  started_at: Date | string | null
  completed_at: Date | string | null
  updated_at: Date | string
}

const JOB_COLUMNS = `
  id::text AS id,
  user_id::text AS user_id,
  type,
  status,
  title,
  input,
  result_text,
  source_kind,
  source_url,
  source_filename,
  temporary_path,
  source_metadata,
  progress,
  progress_message,
  attempt_count,
  max_attempts,
  retry_at,
  processing_token,
  lease_until,
  error_message,
  created_at,
  started_at,
  completed_at,
  updated_at
`

function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function objectValue(value: JobRow['input']): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    title: row.title || '',
    input: objectValue(row.input),
    resultText: row.result_text || null,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    sourceFilename: row.source_filename,
    temporaryPath: row.temporary_path,
    sourceMetadata: objectValue(row.source_metadata),
    progress: Number(row.progress || 0),
    progressMessage: row.progress_message || '',
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 2),
    retryAt: iso(row.retry_at),
    processingToken: row.processing_token,
    leaseUntil: iso(row.lease_until),
    errorMessage: row.error_message,
    createdAt: iso(row.created_at) || new Date(0).toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at) || new Date(0).toISOString(),
  }
}

function clampText(value: string | null | undefined, max: number): string {
  return String(value || '').trim().slice(0, max)
}

/** The text concurrency guard is deliberately small and process-independent. */
export function textConcurrencyLimit(): number {
  const parsed = Number(process.env.TEXT_MAX_CONCURRENT_PER_USER || process.env.TEXT_JOB_CONCURRENCY || 2)
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 10)) : 2
}

export function sttConcurrencyLimit(): number {
  const parsed = Number(process.env.STT_MAX_CONCURRENT_PER_USER || 1)
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 4)) : 1
}

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && isRegisteredJobType(value)
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  if (!isJobType(input.type)) throw new Error(`未注册的任务类型：${String(input.type)}`)
  const id = input.id || randomUUID()
  const sourceKind = input.sourceKind || 'none'
  if (!['upload', 'url', 'none'].includes(sourceKind)) throw new Error('sourceKind 无效')
  const maxAttempts = Number.isSafeInteger(input.maxAttempts)
    ? Math.max(1, Math.min(Number(input.maxAttempts), 2))
    : 2
  const result = await query<JobRow>(
    `INSERT INTO jobs
      (id, user_id, type, title, input, source_kind, source_url, source_filename,
       temporary_path, source_metadata, max_attempts, progress, progress_message)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,0,'排队中')
     RETURNING ${JOB_COLUMNS}`,
    [
      id,
      input.userId,
      input.type,
      clampText(input.title, 200),
      JSON.stringify(input.input || {}),
      sourceKind,
      input.sourceUrl ? clampText(input.sourceUrl, 4_000) : null,
      input.sourceFilename ? clampText(input.sourceFilename, 500) : null,
      input.temporaryPath ? clampText(input.temporaryPath, 2_000) : null,
      JSON.stringify(input.sourceMetadata || {}),
      maxAttempts,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('任务创建失败')
  return toJob(row)
}

export async function getJobForUser(id: string, userId: string): Promise<JobRecord | null> {
  const result = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  )
  return result.rows[0] ? toJob(result.rows[0]) : null
}

export interface ListJobsOptions {
  type?: JobType | null
  status?: JobStatus | null
  search?: string | null
  limit?: number
}

export async function listJobsForUser(userId: string, options: ListJobsOptions = {}): Promise<JobRecord[]> {
  const values: unknown[] = [userId]
  const clauses = ['user_id = $1']
  if (options.type) {
    if (!isJobType(options.type)) throw new Error('任务类型无效')
    values.push(options.type)
    clauses.push(`type = $${values.length}`)
  }
  if (options.status) {
    values.push(options.status)
    clauses.push(`status = $${values.length}`)
  }
  if (options.search?.trim()) {
    values.push(`%${options.search.trim().slice(0, 100)}%`)
    clauses.push(`(title ILIKE $${values.length} OR COALESCE(result_text, '') ILIKE $${values.length})`)
  }
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(Number(options.limit), 100)) : 50
  values.push(limit)
  const result = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${values.length}`,
    values,
  )
  return result.rows.map(toJob)
}

export async function getPendingJobs(limit = 100): Promise<JobRecord[]> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const result = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs
      WHERE status = 'pending' AND (retry_at IS NULL OR retry_at <= now())
      ORDER BY created_at ASC, id ASC
      LIMIT $1`,
    [safeLimit],
  )
  return result.rows.map(toJob)
}

/** Lightweight preflight used by workers that must not claim another handler's job. */
export async function getPendingJobType(id: string): Promise<JobType | null> {
  const result = await query<{ type: JobType }>(
    `SELECT type FROM jobs WHERE id = $1 AND status = 'pending' LIMIT 1`,
    [id],
  )
  return result.rows[0]?.type || null
}

/**
 * Claims one pending job while serializing against other claims for the same
 * user.  The database, rather than an in-process map, enforces the limit so a
 * second local worker/process cannot exceed two text jobs per account.
 */
export async function claimPendingJobWithToken(
  jobId: string,
  leaseSeconds = 15 * 60,
): Promise<string | null> {
  const token = randomUUID()
  return withTransaction(async (client) => {
    const candidate = await client.query<{ user_id: string; type: JobType }>(
      `SELECT user_id, type FROM jobs
        WHERE id = $1 AND status = 'pending'
          AND (retry_at IS NULL OR retry_at <= now())
        FOR UPDATE`,
      [jobId],
    )
    const userId = candidate.rows[0]?.user_id
    if (!userId) return null
    const isStt = candidate.rows[0]?.type === 'stt'
    const active = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM jobs
        WHERE user_id = $1 AND status = 'processing'
          AND (CASE WHEN $2::boolean THEN type = 'stt' ELSE type <> 'stt' END)
          AND (lease_until IS NULL OR lease_until > now())`,
      [userId, isStt],
    )
    const limit = isStt ? sttConcurrencyLimit() : textConcurrencyLimit()
    if (Number(active.rows[0]?.count || 0) >= limit) return null
    const safeLease = Number.isSafeInteger(leaseSeconds) ? Math.max(30, Math.min(leaseSeconds, 60 * 60)) : 15 * 60
    const claimed = await client.query(
      `UPDATE jobs
          SET status = 'processing', processing_token = $2,
              lease_until = now() + ($3 * interval '1 second'),
              started_at = COALESCE(started_at, now()),
              attempt_count = attempt_count + 1,
              progress = GREATEST(progress, 5), progress_message = '处理中',
              updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [jobId, token, safeLease],
    )
    return (claimed.rowCount || 0) > 0 ? token : null
  })
}

export async function heartbeatJob(jobId: string, processingToken: string, leaseSeconds = 15 * 60): Promise<boolean> {
  const safeLease = Number.isSafeInteger(leaseSeconds) ? Math.max(30, Math.min(leaseSeconds, 60 * 60)) : 15 * 60
  const result = await query(
    `UPDATE jobs SET lease_until = now() + ($3 * interval '1 second'), updated_at = now()
      WHERE id = $1 AND processing_token = $2 AND status = 'processing'`,
    [jobId, processingToken, safeLease],
  )
  return (result.rowCount || 0) > 0
}

export async function updateClaimedJobProgress(
  jobId: string,
  processingToken: string,
  progress: number,
  progressMessage: string,
): Promise<boolean> {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(99, Math.round(progress))) : 0
  const result = await query(
    `UPDATE jobs SET progress = $3, progress_message = $4, updated_at = now()
      WHERE id = $1 AND processing_token = $2 AND status = 'processing'`,
    [jobId, processingToken, safeProgress, clampText(progressMessage, 500)],
  )
  return (result.rowCount || 0) > 0
}

export async function completeClaimedJob(
  jobId: string,
  processingToken: string,
  resultText: string,
): Promise<boolean> {
  const text = clampText(resultText, 200_000)
  if (!text) throw new Error('任务结果不得为空')
  return withTransaction(async (client) => {
    const result = await client.query<{ user_id: string; input: Record<string, unknown> | string | null }>(
      `UPDATE jobs
          SET status = 'completed', result_text = $3, error_message = NULL,
              progress = 100, progress_message = '已完成',
              processing_token = NULL, lease_until = NULL, retry_at = NULL,
              temporary_path = NULL, completed_at = now(), updated_at = now()
        WHERE id = $1 AND processing_token = $2 AND status = 'processing'
        RETURNING user_id::text AS user_id, input`,
      [jobId, processingToken, text],
    )
    const completed = result.rows[0]
    if (!completed) return false
    const input = objectValue(completed.input)
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : ''
    if (conversationId && /^[0-9a-f-]{36}$/i.test(conversationId)) {
      await client.query(
        `INSERT INTO agent_messages (id, conversation_id, user_id, role, content, metadata)
         SELECT $1, conversation.id, $2, 'assistant', $3, $4::jsonb
           FROM agent_conversations AS conversation
          WHERE conversation.id = $5 AND conversation.user_id = $2`,
        [randomUUID(), completed.user_id, text, JSON.stringify({ jobId }), conversationId],
      )
      await client.query(
        `UPDATE agent_conversations SET updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [conversationId, completed.user_id],
      )
    }
    return true
  })
}

export async function failClaimedJob(
  jobId: string,
  processingToken: string,
  errorMessage: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE jobs
        SET status = 'failed', result_text = NULL,
            error_message = $3, progress_message = '处理失败',
            processing_token = NULL, lease_until = NULL, retry_at = NULL,
            temporary_path = NULL, completed_at = now(), updated_at = now()
      WHERE id = $1 AND processing_token = $2 AND status = 'processing'`,
    [jobId, processingToken, clampText(errorMessage, 2_000) || '任务处理失败'],
  )
  return (result.rowCount || 0) > 0
}

export async function scheduleClaimedJobRetry(
  jobId: string,
  processingToken: string,
  errorMessage: string,
  delaySeconds = 1,
): Promise<boolean> {
  const delay = Number.isFinite(delaySeconds) ? Math.max(0, Math.min(Math.round(delaySeconds), 300)) : 1
  const result = await query(
    `UPDATE jobs
        SET status = 'pending', error_message = $3,
            progress = 0, progress_message = '等待安全重试',
            processing_token = NULL, lease_until = NULL,
            retry_at = now() + ($4 * interval '1 second'), updated_at = now()
      WHERE id = $1 AND processing_token = $2 AND status = 'processing'
        AND attempt_count < max_attempts`,
    [jobId, processingToken, clampText(errorMessage, 2_000), delay],
  )
  return (result.rowCount || 0) > 0
}

/** Requeue expired leases once; after the configured attempt budget, fail. */
export async function recoverExpiredJobs(excludeIds: string[] = []): Promise<number> {
  const ids = excludeIds.filter((value) => /^[0-9a-f-]{36}$/i.test(value))
  const result = await query(
    `UPDATE jobs
        SET status = CASE WHEN attempt_count < max_attempts THEN 'pending' ELSE 'failed' END,
            error_message = CASE WHEN attempt_count < max_attempts THEN error_message
              ELSE COALESCE(error_message, '任务处理超时') END,
            progress_message = CASE WHEN attempt_count < max_attempts THEN '等待安全重试' ELSE '处理失败' END,
            processing_token = NULL, lease_until = NULL,
            retry_at = CASE WHEN attempt_count < max_attempts THEN now() ELSE NULL END,
            temporary_path = CASE WHEN attempt_count < max_attempts THEN temporary_path ELSE NULL END,
            completed_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE now() END,
            updated_at = now()
      WHERE status = 'processing' AND lease_until IS NOT NULL AND lease_until < now()
        AND NOT (id = ANY($1::uuid[]))`,
    [ids],
  )
  return result.rowCount || 0
}

export async function retryJobForUser(id: string, userId: string): Promise<JobRecord | null> {
  const result = await query<JobRow>(
    `UPDATE jobs
        SET status = 'pending', result_text = NULL, error_message = NULL,
            progress = 0, progress_message = '排队中',
            processing_token = NULL, lease_until = NULL, retry_at = now(),
            started_at = NULL, completed_at = NULL, temporary_path = NULL,
            updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'failed'
        AND attempt_count < max_attempts
      RETURNING ${JOB_COLUMNS}`,
    [id, userId],
  )
  return result.rows[0] ? toJob(result.rows[0]) : null
}

export async function deleteJobForUser(id: string, userId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM jobs WHERE id = $1 AND user_id = $2 AND status <> 'processing'`,
    [id, userId],
  )
  return (result.rowCount || 0) > 0
}

export async function getQueuePosition(id: string, userId?: string): Promise<number | null> {
  const result = await query<{ position: number }>(
    `SELECT position FROM (
       SELECT id, user_id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)::int AS position
         FROM jobs
        WHERE status = 'pending' AND (retry_at IS NULL OR retry_at <= now())
     ) pending WHERE id = $1 ${userId ? 'AND user_id = $2' : ''}`,
    userId ? [id, userId] : [id],
  )
  return result.rows[0] ? Number(result.rows[0].position) : null
}

/** Useful for downstream workers that need a single token-protected row. */
export async function getClaimedJob(id: string, processingToken: string): Promise<JobRecord | null> {
  const result = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs
      WHERE id = $1 AND processing_token = $2 AND status = 'processing' LIMIT 1`,
    [id, processingToken],
  )
  return result.rows[0] ? toJob(result.rows[0]) : null
}

export async function clearTemporaryPath(id: string, processingToken: string): Promise<boolean> {
  const result = await query(
    `UPDATE jobs SET temporary_path = NULL, updated_at = now()
      WHERE id = $1 AND processing_token = $2 AND status = 'processing'`,
    [id, processingToken],
  )
  return (result.rowCount || 0) > 0
}

export async function createRefineJob(input: {
  userId: string
  parent: JobRecord
  instruction: string
  title?: string
  skillIds?: string[]
  profileIds?: string[]
}): Promise<JobRecord> {
  const instruction = clampText(input.instruction, 10_000)
  if (!instruction) throw new Error('优化要求不得为空')
  if (!isTextJobType(input.parent.type)) throw new Error('只有文案任务可以继续优化')
  return createJob({
    userId: input.userId,
    type: input.parent.type,
    title: input.title || `优化：${input.parent.title || input.parent.type}`,
    input: {
      previousText: input.parent.resultText || '',
      instruction,
      parentJobId: input.parent.id,
      skillIds: Array.isArray(input.skillIds) ? input.skillIds.slice(0, 20) : [],
      profileIds: Array.isArray(input.profileIds) ? input.profileIds.slice(0, 20) : [],
    },
  })
}

/** Public summary intentionally omits input/result text, tokens, and paths. */
export function jobSummary(job: JobRecord, queuePosition: number | null = null) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    title: job.title,
    progress: job.progress,
    progressMessage: job.progressMessage,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    queuePosition,
    sourceKind: job.sourceKind,
    sourceUrl: job.sourceUrl,
    sourceFilename: job.sourceFilename,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
  }
}

export function jobDetail(job: JobRecord, queuePosition: number | null = null) {
  return {
    ...jobSummary(job, queuePosition),
    input: job.input,
    resultText: job.status === 'completed' ? job.resultText : null,
    sourceMetadata: job.sourceMetadata,
  }
}

// Kept as a narrow alias for worker code that prefers an explicit queue name.
export const enqueueTextJob = createJob
