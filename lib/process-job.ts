import { query } from './db'
import { buildPrompt } from './features'
import { getJobDefinition, isTextJobType } from './job-registry'
import {
  claimPendingJobWithToken,
  completeClaimedJob,
  failClaimedJob,
  getClaimedJob,
  heartbeatJob,
  scheduleClaimedJobRetry,
  updateClaimedJobProgress,
} from './jobs'
import { generateText, TEXT_GENERATION_TIMEOUT } from './ai'
import { processSttJob } from './stt'

const HEARTBEAT_MS = 30_000

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, max = 10_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item)).slice(0, 20)
}

async function visibleAssetContext(
  table: 'skills' | 'profiles',
  ids: string[],
  userId: string,
): Promise<string> {
  if (!ids.length) return ''
  const enabledClause = table === 'skills' ? 'AND enabled = true' : ''
  const result = await query<{ name: string; content: string; scope: string }>(
    `SELECT name, content, scope FROM ${table}
      WHERE id = ANY($1::uuid[]) ${enabledClause}
        AND (scope = 'system' OR (scope = 'private' AND owner_id = $2))
      ORDER BY created_at ASC, id ASC`,
    [ids, userId],
  )
  if (!result.rows.length) return ''
  return result.rows.map((row) => `- ${row.name}（${row.scope === 'system' ? '系统' : '私有'}）\n${String(row.content).slice(0, 50_000)}`).join('\n\n')
}

async function libraryContext(userId: string, values: Record<string, unknown>, prompt: string): Promise<string> {
  if (values.useLibrary === false) return ''
  const term = stringValue(values.librarySearch || values.search || values.theme || prompt, 120)
  const pattern = term ? `%${term}%` : null
  const result = await query<{ title: string; content: string; visibility: string }>(
    `SELECT title, content, visibility FROM library_items
      WHERE (visibility = 'team' OR creator_id = $1)
        AND ($2::text IS NULL OR title ILIKE $2 OR summary ILIKE $2 OR content ILIKE $2)
      ORDER BY updated_at DESC, id DESC LIMIT 3`,
    [userId, pattern],
  )
  return result.rows.map((row, index) => `【资料 ${index + 1}：${row.title}（${row.visibility === 'team' ? '团队共享' : '我的私有'}）】\n${String(row.content).slice(0, 4_000)}`).join('\n\n')
}

function inputValues(input: Record<string, unknown>): Record<string, string> {
  const nested = asObject(input.values || input.params)
  const source = Object.keys(nested).length ? nested : input
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !['skillIds', 'profileIds', 'useLibrary', 'librarySearch', 'search', 'previousText', 'instruction', 'parentJobId', 'prompt'].includes(key))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 20_000) : String(value ?? '')]))
}

function retryableError(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === TEXT_GENERATION_TIMEOUT) return false
  if ((error as { retryable?: unknown } | null)?.retryable === true) return true
  const status = Number((error as { status?: unknown } | null)?.status || 0)
  return status === 429 || status >= 500
}

/**
 * Executes one queued job and dispatches it to the text or STT processor.
 */
export async function tryProcessJob(jobId: string): Promise<boolean> {
  const processingToken = await claimPendingJobWithToken(jobId)
  if (!processingToken) return false
  const job = await getClaimedJob(jobId, processingToken)
  if (!job) return false

  const heartbeat = setInterval(() => {
    // A lost lease makes every subsequent write fail on its processing token;
    // this best-effort heartbeat only extends work owned by this worker.
    void heartbeatJob(jobId, processingToken).catch(() => undefined)
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  try {
    const definition = getJobDefinition(job.type)
    if (!definition) throw new Error(`未注册的任务类型：${job.type}`)
    if (job.type === 'stt') {
      try {
        await processSttJob(job, processingToken)
        return true
      } catch {
        // STT owns its sanitized terminal error and temporary-file cleanup.
        return false
      }
    }
    if (definition.implemented === false) throw new Error(`任务处理器尚未实现：${job.type}`)
    if (!isTextJobType(job.type)) throw new Error(`任务类型不支持文字生成：${job.type}`)

    const input = asObject(job.input)
    const values = inputValues(input)
    const previousText = stringValue(input.previousText, 200_000)
    const instruction = stringValue(input.instruction, 10_000)
    const basePrompt = stringValue(input.prompt, 20_000)
      || (previousText
        ? `请在不丢失关键信息的前提下优化以下文案。\n上一版：\n${previousText}\n\n优化要求：${instruction || '让表达更自然、清晰、可信。'}`
        : buildPrompt(job.type, values))
    const skillContext = await visibleAssetContext('skills', stringArray(input.skillIds), job.userId)
    const profileContext = await visibleAssetContext('profiles', stringArray(input.profileIds), job.userId)
    const references = await libraryContext(job.userId, input, basePrompt)
    const systemPrompt = [
      '你是 HCLite 的专业中文文案助手。',
      skillContext ? `\n【用户选择的 Skill】\n${skillContext}` : '',
      profileContext ? `\n【用户选择的 Profile】\n${profileContext}` : '',
    ].filter(Boolean).join('\n')

    await updateClaimedJobProgress(jobId, processingToken, 30, '正在生成文字')
    const text = await generateText(basePrompt, systemPrompt, job.userId, stringArray(input.profileIds), undefined, {
      profileContext: '',
      libraryContext: references,
      onRetry: async () => {
        await updateClaimedJobProgress(jobId, processingToken, 35, '服务响应较慢，正在安全重试')
      },
    })
    if (!text.trim()) throw new Error('模型未返回可用文本')
    await updateClaimedJobProgress(jobId, processingToken, 80, '正在保存结果')
    return await completeClaimedJob(jobId, processingToken, text)
  } catch (error) {
    const message = error instanceof Error ? error.message : '文案生成失败'
    const attempt = job.attemptCount
    if (retryableError(error) && attempt < job.maxAttempts) {
      const scheduled = await scheduleClaimedJobRetry(jobId, processingToken, message, Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds || 2))
      if (scheduled) return false
    }
    await failClaimedJob(jobId, processingToken, message)
    return false
  } finally {
    clearInterval(heartbeat)
  }
}
