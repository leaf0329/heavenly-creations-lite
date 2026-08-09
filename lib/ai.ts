import 'server-only'

import { getStoredServiceConfig } from './service-config'
import { buildResponsesTextRequest, joinResponsesUrl } from './responses-api'
import { extractRawTextResult, extractTextResult } from './text-result'

export const TEXT_GENERATION_TIMEOUT = 'TEXT_GENERATION_TIMEOUT'
const TEXT_GENERATION_TIMEOUT_MS = 90_000

export interface GenerateTextOptions {
  outputFormat?: 'plain' | 'raw'
  profileContext?: string
  libraryContext?: string
  /** Called exactly once before the built-in timeout retry. */
  onRetry?: (retry: number, retryLimit: number) => void | Promise<void>
}

export interface TextProviderError extends Error {
  status?: number
  retryable?: boolean
  retryAfterSeconds?: number
}

function providerError(message: string, details: Partial<TextProviderError> = {}): TextProviderError {
  return Object.assign(new Error(message), details)
}

function isTimeout(error: unknown): boolean {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; status?: unknown } | null
  if (!candidate) return false
  return candidate.name === 'AbortError'
    || candidate.name === 'TimeoutError'
    || ['ABORT_ERR', 'ERR_ABORTED', 'ETIMEDOUT'].includes(String(candidate.code || ''))
    || candidate.status === 408
    || /timed?\s*out|timeout|aborted/i.test(String(candidate.message || ''))
}

async function fetchResponses(config: { endpoint: string; apiKey: string }, body: unknown): Promise<unknown> {
  if (!config.apiKey) throw new Error('未配置文字生成 API Key')
  if (!config.endpoint) throw new Error('未配置文字生成接口地址')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEXT_GENERATION_TIMEOUT_MS)
  try {
    const response = await fetch(joinResponsesUrl(config.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const raw = await response.text().catch(() => '')
    let parsed: unknown = null
    try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
    if (!response.ok) {
      const object = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
      const nested = object.error && typeof object.error === 'object' ? object.error as Record<string, unknown> : {}
      const message = String(nested.message || object.message || raw || `HTTP ${response.status}`).slice(0, 300)
      const retryAfter = Number(response.headers.get('retry-after') || '')
      throw providerError(`文字生成请求失败：${message}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterSeconds: Number.isFinite(retryAfter) ? Math.max(1, Math.min(retryAfter, 300)) : undefined,
      })
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

function refsText(refs: Array<Record<string, unknown>> | undefined): string {
  if (!refs?.length) return ''
  return refs.map((ref, index) => {
    const title = String(ref.title || `参考资料 ${index + 1}`).slice(0, 200)
    const content = String(ref.content || '').slice(0, 4_000)
    return `【${title}】\n${content}`
  }).join('\n\n')
}

/**
 * Calls the configured `text` service only.  Positional arguments are kept
 * compatible with the extracted application's text worker; HCLite itself
 * passes all selected asset context through the final options object.
 */
export async function generateText(
  prompt: string,
  systemPrompt = '你是一个专业的文案写手。请根据用户需求生成高质量文案。',
  _userId?: string,
  _profileIds?: string[],
  refs?: Array<Record<string, unknown>>,
  options: GenerateTextOptions = {},
): Promise<string> {
  const config = await getStoredServiceConfig('text')
  if (!config?.apiKey) throw new Error('未配置文字生成 API Key，请先在 API 配置中保存 text 服务')
  const profile = options.profileContext?.trim() ? `\n【参考 Profile】\n${options.profileContext.trim()}\n` : ''
  const library = options.libraryContext?.trim() || refsText(refs)
  const libraryBlock = library ? `\n【仅供参考的信息库资料】\n${library}\n` : ''
  const input = `${prompt.trim()}${profile}${libraryBlock}`.trim()
  // The model receives the user's requested format verbatim.  HCLite only
  // normalizes the returned payload to text; it must not add hidden titles,
  // duration, camera, length, or other creative constraints.
  const instructions = systemPrompt
  const request = buildResponsesTextRequest({
    model: config.model,
    instructions,
    input,
    temperature: Number(config.options.temperature ?? 0.7),
    maxOutputTokens: Number(config.options.max_output_tokens ?? 8192),
  })

  let retried = false
  while (true) {
    let data: unknown
    try {
      data = await fetchResponses({ endpoint: config.endpoint, apiKey: config.apiKey }, request)
    } catch (error) {
      if (!isTimeout(error) || retried) {
        if (isTimeout(error)) throw Object.assign(new Error('文字生成超时，请稍后重试'), { code: TEXT_GENERATION_TIMEOUT, retryable: false })
        throw error
      }
      retried = true
      await options.onRetry?.(1, 1)
      continue
    }
    const text = options.outputFormat === 'raw' ? extractRawTextResult(data) : extractTextResult(data)
    if (!text) throw new Error('文字生成接口返回空内容')
    return text.trim()
  }
}
