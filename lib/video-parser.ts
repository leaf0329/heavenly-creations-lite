import 'server-only'

import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { Agent, fetch as undiciFetch } from 'undici'
import { getStoredServiceConfig } from './service-config'
import { DEFAULT_STT_MAX_BYTES } from './media-command'

const MAX_REDIRECTS = 4
const DEFAULT_TIMEOUT_MS = 120_000
const SUPPORTED_PLATFORMS = new Set([
  'douyin', 'bilibili', 'xiaohongshu', 'kuaishou', 'toutiao', 'weixin', 'weibo', 'youtube', 'tiktok',
])

export interface ParsedVideoSource {
  sourceUrl: string
  mediaUrl: string
  platform: string
  title: string | null
  metadata: Record<string, unknown>
}

export interface DownloadedVideo {
  filePath: string
  size: number
  mimeType: string
  mediaUrl: string
}

function maxBytes(): number {
  const value = Number(process.env.STT_MAX_UPLOAD_BYTES || DEFAULT_STT_MAX_BYTES)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_STT_MAX_BYTES
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function privateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

function privateIPv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (value.startsWith('::ffff:')) return privateIPv4(value.slice('::ffff:'.length))
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
    || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
    || value.startsWith('ff')
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? privateIPv4(address) : family === 6 ? privateIPv6(address) : true
}

function allowedDomain(hostname: string, allowList: readonly string[]): boolean {
  if (!allowList.length) return true
  return allowList.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\./, '')
    return domain && (hostname === domain || hostname.endsWith(`.${domain}`))
  })
}

function allowedDomainsFromOptions(options: Record<string, unknown> | undefined, key: string): string[] {
  const envFallback = key === 'media_allowlist'
    ? process.env.VIDEO_PARSER_MEDIA_ALLOWLIST
    : process.env.VIDEO_PARSER_ALLOWLIST
  const value = options?.[key] ?? envFallback
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return []
}

async function pinnedTarget(url: URL, allowList: readonly string[]): Promise<{ address: string; family: 4 | 6 }> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http/https 视频地址')
  if (url.username || url.password) throw new Error('视频地址不允许包含认证信息')
  const hostname = normalizedHost(url.hostname)
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('不允许访问内部视频地址')
  }
  if (!allowedDomain(hostname, allowList)) throw new Error('视频地址不在允许的域名列表中')
  const family = isIP(hostname)
  const addresses = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : await dns.promises.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('视频地址解析到内部或保留网络')
  }
  return addresses[0] as { address: string; family: 4 | 6 }
}

async function closeAgent(agent: Agent): Promise<void> {
  await agent.close().catch(() => undefined)
}

/** Fetch one URL with DNS pinning, redirect limits, and response-size limits. */
export async function safeVideoFetch(
  input: string,
  options: {
    timeoutMs?: number
    maxRedirects?: number
    maxResponseBytes?: number
    allowedDomains?: readonly string[]
    headers?: HeadersInit
  } = {},
): Promise<Response> {
  let current: URL
  try { current = new URL(input) } catch { throw new Error('无效的视频 URL') }
  const redirects = Math.max(0, Math.min(options.maxRedirects ?? MAX_REDIRECTS, 10))
  const allowList = options.allowedDomains || []
  for (let index = 0; index <= redirects; index++) {
    const pinned = await pinnedTarget(current, allowList)
    const agent = new Agent({
      connect: {
        lookup: ((_: string, lookupOptions: { all?: boolean }, callback: (error: Error | null, address?: unknown, family?: number) => void) => {
          if (lookupOptions?.all) callback(null, [pinned])
          else callback(null, pinned.address, pinned.family)
        }) as never,
      },
    })
    let response: Response
    try {
      response = await undiciFetch(current, {
        dispatcher: agent,
        redirect: 'manual',
        headers: options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      }) as unknown as Response
    } catch (error) {
      await closeAgent(agent)
      throw error
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      await closeAgent(agent)
      if (!location) throw new Error('远程视频返回无效重定向')
      if (index === redirects) throw new Error('远程视频重定向次数过多')
      current = new URL(location, current)
      continue
    }
    const declared = Number(response.headers.get('content-length') || 0)
    if (options.maxResponseBytes && declared > options.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined)
      await closeAgent(agent)
      throw new Error('远程视频超过大小限制')
    }
    if (!response.body) {
      await closeAgent(agent)
      return response
    }
    // Keep the pinned dispatcher alive while the caller consumes the body,
    // then close it on EOF/cancel so every request releases its sockets.
    const reader = response.body.getReader()
    let received = 0
    const maxResponseBytes = options.maxResponseBytes
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            await closeAgent(agent)
            return
          }
          received += value.byteLength
          if (maxResponseBytes && received > maxResponseBytes) {
            await reader.cancel().catch(() => undefined)
            controller.error(new Error('远程视频超过大小限制'))
            await closeAgent(agent)
            return
          }
          controller.enqueue(value)
        } catch (error) {
          controller.error(error)
          await closeAgent(agent)
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined)
        await closeAgent(agent)
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  throw new Error('远程视频重定向次数过多')
}

export function detectPlatform(sourceUrl: string): string {
  const host = (() => {
    try { return normalizedHost(new URL(sourceUrl).hostname) } catch { return '' }
  })()
  if (host === 'douyin.com' || host.endsWith('.douyin.com') || host.endsWith('iesdouyin.com')) return 'douyin'
  if (host === 'xhslink.com' || host.endsWith('.xhslink.com') || host.endsWith('.xiaohongshu.com')) return 'xiaohongshu'
  if (host === 'kuaishou.com' || host.endsWith('.kuaishou.com') || host.endsWith('.gifshow.com')) return 'kuaishou'
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') return 'bilibili'
  if (host === 'ixigua.com' || host.endsWith('.ixigua.com') || host === 'toutiao.com' || host.endsWith('.toutiao.com')) return 'toutiao'
  if (host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com') || host.endsWith('.wechat.com') || host.includes('channels')) return 'weixin'
  if (host === 'weibo.com' || host.endsWith('.weibo.com') || host.endsWith('.weibo.cn')) return 'weibo'
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube'
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok'
  return 'unknown'
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  bilibili: 'B站',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  toutiao: '头条',
  weixin: '微信视频号',
  weibo: '微博',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform
}

function endpointPath(platform: string, options: Record<string, unknown>): { path: string; param: string } {
  const configured = options.resolve_path || options.path
  if (typeof configured === 'string' && configured.trim()) {
    return { path: configured.trim(), param: typeof options.url_param === 'string' ? options.url_param : 'url' }
  }
  const defaults: Record<string, { path: string; param: string }> = {
    douyin: { path: '/api/v1/douyin/web/fetch_one_video_by_share_url', param: 'share_url' },
    bilibili: { path: '/api/v1/bilibili/web/fetch_one_video_info', param: 'url' },
    xiaohongshu: { path: '/api/v1/xiaohongshu/web/fetch_note_by_url', param: 'note_url' },
    kuaishou: { path: '/api/v1/kuaishou/web/fetch_one_video_by_url', param: 'url' },
    toutiao: { path: '/api/v1/toutiao/web/fetch_one_video', param: 'url' },
    weixin: { path: '/api/v1/wechat/channels/v2/fetch_one_video_by_url', param: 'url' },
    weibo: { path: '/api/v1/weibo/web/fetch_one_video', param: 'url' },
    youtube: { path: '/api/v1/youtube/web/fetch_one_video_info', param: 'url' },
    tiktok: { path: '/api/v1/tiktok/web/fetch_one_video_info', param: 'url' },
  }
  return defaults[platform] || { path: '/resolve', param: 'url' }
}

function firstUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstUrl(entry)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

function findMediaUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null
  const direct = firstUrl(value)
  if (direct) return direct
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findMediaUrl(entry, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const preferredKeys = [
    'download_url', 'downloadUrl', 'original_video_url', 'video_url', 'videoUrl',
    'play_url', 'playUrl', 'media_url', 'mediaUrl', 'master_url', 'masterUrl', 'url',
  ]
  for (const key of preferredKeys) {
    const found = findMediaUrl(record[key], depth + 1)
    if (found) return found
  }
  for (const [key, entry] of Object.entries(record)) {
    if (/cover|avatar|image|thumbnail|music|audio/i.test(key)) continue
    const found = findMediaUrl(entry, depth + 1)
    if (found) return found
  }
  return null
}

function findTitle(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const title = findTitle(entry, depth + 1)
      if (title) return title
    }
    return null
  }
  const record = value as Record<string, unknown>
  for (const key of ['title', 'desc', 'description', 'caption', 'name']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim().slice(0, 500)
  }
  for (const entry of Object.values(record)) {
    const title = findTitle(entry, depth + 1)
    if (title) return title
  }
  return null
}

function ensureSafeSourceUrl(sourceUrl: string): URL {
  let parsed: URL
  try { parsed = new URL(sourceUrl) } catch { throw new Error('请输入有效的视频分享链接') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('视频分享链接必须使用公开 http/https 地址')
  }
  const platform = detectPlatform(parsed.toString())
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error('暂不支持该视频平台链接')
  return parsed
}

/** Resolve a supported platform share URL into a short-lived media URL. */
export async function parseVideoUrl(sourceUrl: string): Promise<ParsedVideoSource> {
  const parsedSource = ensureSafeSourceUrl(sourceUrl.trim())
  const canonicalSource = parsedSource.toString()
  const platform = detectPlatform(canonicalSource)
  const config = await getStoredServiceConfig('video_parser')
  if (!config?.enabled || !config.endpoint.trim()) throw new Error('视频链接解析服务尚未配置')
  if (!config.apiKey?.trim()) throw new Error('视频链接解析服务 API Key 尚未配置')
  let endpoint: URL
  try { endpoint = new URL(config.endpoint) } catch { throw new Error('视频链接解析服务地址无效') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('视频链接解析服务地址无效')
  }
  const { path: resolvePath, param } = endpointPath(platform, config.options)
  const apiUrl = new URL(resolvePath, endpoint)
  apiUrl.searchParams.set(param, canonicalSource)
  const response = await safeVideoFetch(apiUrl.toString(), {
    timeoutMs: Number(config.options.timeout_ms) > 0 ? Number(config.options.timeout_ms) : 30_000,
    maxRedirects: Number(config.options.max_redirects) >= 0 ? Number(config.options.max_redirects) : 2,
    maxResponseBytes: 8 * 1024 * 1024,
    allowedDomains: allowedDomainsFromOptions(config.options, 'parser_allowlist'),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'HCLite/1.0 video-parser',
    },
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`视频链接解析失败 (HTTP ${response.status})`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const mediaUrl = findMediaUrl(payload)
  if (!mediaUrl || mediaUrl === canonicalSource) throw new Error('视频链接解析服务未返回可用媒体地址')
  // Validate the returned address now, before the downloader follows it.
  const media = new URL(mediaUrl)
  if (!['http:', 'https:'].includes(media.protocol) || media.username || media.password) {
    throw new Error('视频链接解析服务返回了无效媒体地址')
  }
  return {
    sourceUrl: canonicalSource,
    mediaUrl: media.toString(),
    platform,
    title: findTitle(payload),
    metadata: {
      platform,
      parser: config.provider || 'custom',
      mediaAllowlist: allowedDomainsFromOptions(config.options, 'media_allowlist'),
    },
  }
}

/** Download only the resolved media stream into a unique temporary file. */
export async function downloadResolvedMedia(
  source: ParsedVideoSource,
  tempDir: string,
  jobId = 'stt',
): Promise<DownloadedVideo> {
  const configuredAllowlist = Array.isArray(source.metadata.mediaAllowlist)
    ? source.metadata.mediaAllowlist.filter((value): value is string => typeof value === 'string')
    : undefined
  const response = await safeVideoFetch(source.mediaUrl, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxResponseBytes: maxBytes(),
    allowedDomains: configuredAllowlist?.length ? configuredAllowlist : allowedDomainsFromOptions(undefined, 'media_allowlist'),
    headers: {
      Referer: source.sourceUrl,
      'User-Agent': 'Mozilla/5.0 HCLite/1.0',
    },
  })
  if (!response.ok || !response.body) throw new Error(`视频媒体下载失败 (HTTP ${response.status})`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes()) {
    await response.body.cancel().catch(() => undefined)
    throw new Error('远程视频超过大小限制')
  }
  await fs.promises.mkdir(tempDir, { recursive: true })
  const contentType = (response.headers.get('content-type') || 'video/mp4').split(';', 1)[0]!.trim().toLowerCase()
  const extension = contentType.includes('webm') ? '.webm' : contentType.includes('quicktime') ? '.mov' : '.mp4'
  const filePath = path.join(tempDir, `stt-${jobId.replace(/[^a-zA-Z0-9_-]/g, '') || randomUUID()}-${randomUUID()}${extension}`)
  const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
  const reader = response.body.getReader()
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes()) throw new Error('远程视频超过大小限制')
      if (!output.write(Buffer.from(value))) await new Promise<void>((resolve) => output.once('drain', resolve))
    }
    output.end()
    await new Promise<void>((resolve, reject) => {
      output.once('finish', resolve)
      output.once('error', reject)
    })
    if (!received) throw new Error('远程视频为空')
    return { filePath, size: received, mimeType: contentType, mediaUrl: source.mediaUrl }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    output.destroy()
    await fs.promises.rm(filePath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}
