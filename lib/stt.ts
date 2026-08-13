import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import { getStoredServiceConfig } from './service-config'
import {
  clearTemporaryPath,
  completeClaimedJob,
  failClaimedJob,
  updateClaimedJobProgress,
  type JobRecord,
} from './jobs'
import { extractAudio, splitAudio } from './media-command'
import { downloadResolvedMedia, parseVideoUrl } from './video-parser'
import { deleteObject, downloadObject, isOwnedUploadObjectKey } from './oss-storage'

const TEMP_ROOT = path.resolve(process.cwd(), 'data', 'stt-temp')
const DEFAULT_STT_TIMEOUT_MS = 15 * 60_000

export interface SttProcessResult {
  text: string
  sourceUrl: string | null
  sourceFilename: string | null
}

/** Public job projection; never expose temporary paths or processing tokens. */
export function toPublicSttJob(job: JobRecord) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    title: job.title,
    resultText: job.resultText,
    sourceKind: job.sourceKind,
    sourceUrl: job.sourceUrl,
    sourceFilename: job.sourceFilename,
    sourceMetadata: job.sourceMetadata,
    progress: job.progress,
    progressMessage: job.progressMessage,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    retryAt: job.retryAt,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
  }
}

function safeInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function endpointForTranscriptions(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/, '')
  if (/\/audio\/transcriptions$/i.test(value)) return value
  return `${value}/audio/transcriptions`
}

function safeTemporaryPath(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  const candidate = path.resolve(filePath)
  const relative = path.relative(TEMP_ROOT, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return candidate
}

async function removePath(filePath: string | null | undefined): Promise<void> {
  const safe = safeTemporaryPath(filePath)
  if (!safe) return
  await fs.promises.rm(safe, { force: true, recursive: true }).catch(() => undefined)
}

/** Remove an upload path after a user deletes an unprocessed job. */
export async function removeSttTemporaryPath(filePath: string | null | undefined): Promise<void> {
  await removePath(filePath)
}

function configOptionNumber(options: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(options[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function cleanProviderText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of ['text', 'transcript', 'result']) {
    if (typeof record[key] === 'string') return record[key].trim()
  }
  if (record.data && typeof record.data === 'object') return cleanProviderText(record.data)
  return ''
}

async function transcribeAudioFile(audioPath: string): Promise<string> {
  const config = await getStoredServiceConfig('audio')
  if (!config?.enabled || !config.endpoint.trim()) throw new Error('音频转写服务尚未配置')
  if (!config.apiKey?.trim()) throw new Error('音频转写服务 API Key 尚未配置')
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size <= 0) throw new Error('音频文件不存在')

  const form = new FormData()
  // openAsBlob streams the file from disk when undici builds the multipart
  // request. This avoids loading a potentially large audio segment into RAM.
  const fileBlob = await fs.openAsBlob(audioPath, { type: 'audio/mpeg' })
  form.append('file', fileBlob, 'audio.mp3')
  form.append('model', config.model.trim() || 'whisper-1')
  const options = config.options || {}
  for (const key of ['language', 'prompt', 'response_format', 'temperature']) {
    const value = options[key]
    if (typeof value === 'string' || typeof value === 'number') form.append(key, String(value))
  }

  const timeoutMs = configOptionNumber(options, 'timeout_ms', 'timeout') || DEFAULT_STT_TIMEOUT_MS
  const response = await fetch(endpointForTranscriptions(config.endpoint), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(Math.max(30_000, Math.min(timeoutMs, DEFAULT_STT_TIMEOUT_MS))),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    // Do not include a provider response body: it may contain secrets or a
    // long HTML error page. The job error is intentionally generic.
    throw new Error(`转写服务请求失败 (${response.status})`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const text = cleanProviderText(payload)
  if (!text) throw new Error('转写服务未返回文字')
  return text
}

function uploadObjectKey(job: JobRecord): string {
  const objectKey = typeof job.sourceMetadata.ossObjectKey === 'string'
    ? job.sourceMetadata.ossObjectKey
    : ''
  if (!objectKey || !isOwnedUploadObjectKey(objectKey, job.userId)) {
    throw new Error('上传文件已失效，请重新上传')
  }
  return objectKey
}

function sourceKind(job: JobRecord): 'upload' | 'url' {
  if (job.sourceKind === 'upload') return 'upload'
  if (job.sourceKind === 'url' && job.sourceUrl) return 'url'
  throw new Error('转写任务缺少有效视频来源')
}

function jobTempDir(jobId: string): string {
  return path.join(TEMP_ROOT, `job-${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}`)
}

async function updateProgress(job: JobRecord, token: string | undefined, progress: number, message: string): Promise<void> {
  if (!token) return
  await updateClaimedJobProgress(job.id, token, progress, message).catch(() => undefined)
}

/**
 * Execute one claimed STT job.
 *
 * When a processing token is supplied this function owns the terminal state:
 * it completes or fails the row and always clears `temporary_path`. Without a
 * token it is a pure worker helper which returns the transcript and leaves
 * queue state to the caller.
 */
export async function processSttJob(job: JobRecord, processingToken?: string): Promise<string> {
  if (job.type !== 'stt') throw new Error('不是视频转写任务')
  const kind = sourceKind(job)
  const dir = jobTempDir(job.id)
  let videoPath: string | null = null
  let audioPath: string | null = null
  let segments: string[] = []
  let finalText = ''
  let failure: Error | null = null
  let objectKey: string | null = null

  try {
    await fs.promises.mkdir(dir, { recursive: true })
    if (kind === 'upload') {
      objectKey = uploadObjectKey(job)
      videoPath = path.join(dir, 'source-video')
      await updateProgress(job, processingToken, 15, '正在读取上传视频')
      await downloadObject(objectKey, videoPath)
    } else {
      await updateProgress(job, processingToken, 15, '正在解析视频链接')
      const parsed = await parseVideoUrl(job.sourceUrl!)
      const downloaded = await downloadResolvedMedia(parsed, dir, job.id)
      videoPath = downloaded.filePath
    }

    await updateProgress(job, processingToken, 35, '正在提取音频')
    audioPath = await extractAudio(videoPath, path.join(dir, 'audio.mp3'), job.id)
    const audioConfig = await getStoredServiceConfig('audio')
    const segmentSeconds = configOptionNumber(audioConfig?.options || {}, 'segment_seconds', 'segmentSeconds') || 0
    if (segmentSeconds > 0) {
      segments = await splitAudio(audioPath, dir, segmentSeconds, job.id)
    }

    await updateProgress(job, processingToken, 60, '正在转写音频')
    if (segments.length > 1) {
      const texts: string[] = []
      for (let index = 0; index < segments.length; index++) {
        await updateProgress(job, processingToken, 60 + Math.floor((index / segments.length) * 30), `正在转写第 ${index + 1}/${segments.length} 段`)
        texts.push(await transcribeAudioFile(segments[index]!))
      }
      finalText = texts.filter(Boolean).join('\n').trim()
    } else {
      finalText = await transcribeAudioFile(audioPath)
    }
    if (!finalText) throw new Error('转写结果为空')
    await updateProgress(job, processingToken, 95, '正在保存转写结果')
    if (processingToken) {
      const completed = await completeClaimedJob(job.id, processingToken, finalText)
      if (!completed) throw new Error('任务状态已改变，请刷新后重试')
    }
    return finalText
  } catch (error) {
    failure = error instanceof Error ? error : new Error('视频转写失败')
    if (processingToken) {
      await failClaimedJob(job.id, processingToken, safeJobError(failure)).catch(() => undefined)
    }
    throw failure
  } finally {
    // The source upload may be outside this job-specific directory; both paths
    // are constrained to data/stt-temp before removal.
    await removePath(videoPath)
    await removePath(audioPath)
    for (const segment of segments) await removePath(segment)
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    if (objectKey) await deleteObject(objectKey).catch(() => undefined)
    if (processingToken) await clearTemporaryPath(job.id, processingToken).catch(() => undefined)
    void failure
  }
}

function safeJobError(error: Error): string {
  const message = error.message
  if (/已失效|重新上传|缺少有效|尚未配置|API Key/.test(message)) return message.slice(0, 500)
  if (/超时|timeout/i.test(message)) return '视频转写超时，请稍后重试'
  if (/媒体|FFmpeg|音频|视频|转写/.test(message)) return message.replace(/[A-Z]:\\[^ ]+/gi, '[临时文件]').slice(0, 500)
  return '视频转写失败，请稍后重试'
}

export const STT_MAX_UPLOAD_BYTES = safeInteger(process.env.STT_MAX_UPLOAD_BYTES, 500 * 1024 * 1024, 1 * 1024 * 1024, 2 * 1024 * 1024 * 1024)
export const STT_MAX_TOTAL_BYTES = Math.min(STT_MAX_UPLOAD_BYTES + 2 * 1024 * 1024, 2 * 1024 * 1024 * 1024)
