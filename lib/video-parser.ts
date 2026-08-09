import 'server-only'

import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { Agent, fetch as undiciFetch } from 'undici'
import { getStoredServiceConfig } from './service-config'
import { DEFAULT_STT_MAX_BYTES } from './media-command'
import { decryptWeChatMediaFile } from './wechat-channels-decrypt'

const MAX_REDIRECTS = 4
const DEFAULT_TIMEOUT_MS = 120_000
export const SUPPORTED_VIDEO_PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'toutiao', 'weixin', 'weibo',
] as const
type SupportedVideoPlatform = (typeof SUPPORTED_VIDEO_PLATFORMS)[number]
const SUPPORTED_PLATFORMS = new Set<string>(SUPPORTED_VIDEO_PLATFORMS)

export interface ParsedVideoSource {
  sourceUrl: string
  mediaUrl: string
  platform: string
  title: string | null
  metadata: Record<string, unknown>
  decodeKey?: string
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
    method?: 'GET' | 'POST'
    body?: string
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
        method: options.method || 'GET',
        body: options.body,
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
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('x-hclite-final-url', current.toString())
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
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
}

export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform
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

function pathValue(value: unknown, pathParts: readonly (string | number)[]): unknown {
  let current = value
  for (const part of pathParts) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[part]
      continue
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

interface TikHubEndpoint {
  path: string
  param: string
  extract: (payload: unknown) => string | null
}

interface TikHubRequest {
  url: URL
  method?: 'GET' | 'POST'
  body?: string
  extract: (payload: unknown) => string | null
}

function douyinDetail(payload: unknown): unknown {
  return pathValue(payload, ['data', 'aweme_detail'])
    || pathValue(payload, ['data', 'data', 'aweme_detail'])
    || pathValue(payload, ['aweme_detail'])
    || null
}

function addressUrl(address: unknown): string | null {
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    const record = address as Record<string, unknown>
    return firstUrl(record.url_list) || firstUrl(record.url) || firstUrl(address)
  }
  return firstUrl(address)
}

/** TikHub Douyin Web/App V3 response adapter retained from the full project. */
export function extractDouyinMediaUrl(payload: unknown): string | null {
  const direct = firstUrl(pathValue(payload, ['data', 'original_video_url']))
    || firstUrl(pathValue(payload, ['data', 'data', 'original_video_url']))
  if (direct) return direct

  const video = pathValue(douyinDetail(payload), ['video'])
    || pathValue(payload, ['data', 'video'])
    || pathValue(payload, ['data', 'data', 'video'])
  if (!video || typeof video !== 'object' || Array.isArray(video)) return null
  const videoRecord = video as Record<string, unknown>
  const h264 = addressUrl(videoRecord.play_addr_h264) || addressUrl(videoRecord.play_addr)
  if (h264) return h264

  const bitRates = Array.isArray(videoRecord.bit_rate) ? [...videoRecord.bit_rate] : []
  bitRates.sort((left, right) =>
    Number(pathValue(right, ['play_addr', 'data_size']) || pathValue(right, ['bit_rate']) || 0)
      - Number(pathValue(left, ['play_addr', 'data_size']) || pathValue(left, ['bit_rate']) || 0))
  for (const rate of bitRates) {
    const candidate = addressUrl(pathValue(rate, ['play_addr']))
    if (candidate) return candidate
  }
  return addressUrl(videoRecord.play_addr_265) || addressUrl(videoRecord.play_addr_bytevc1)
}

function extractBilibiliMediaUrl(payload: unknown): string | null {
  // DASH audio is sufficient for speech-to-text and avoids downloading a separate video track.
  return firstUrl(pathValue(payload, ['data', 'data', 'dash', 'audio', 0, 'baseUrl']))
    || firstUrl(pathValue(payload, ['data', 'data', 'dash', 'audio', 0, 'base_url']))
    || firstUrl(pathValue(payload, ['data', 'dash', 'audio', 0, 'baseUrl']))
    || firstUrl(pathValue(payload, ['data', 'dash', 'audio', 0, 'base_url']))
    || firstUrl(pathValue(payload, ['data', 'data', 'durl', 0, 'url']))
    || firstUrl(pathValue(payload, ['data', 'durl', 0, 'url']))
}

function extractWeChatMedia(payload: unknown): string | null {
  const full = firstUrl(pathValue(payload, ['data', 'media', 'full_url']))
    || firstUrl(pathValue(payload, ['data', 'data', 'media', 'full_url']))
  if (full) return full
  const base = pathValue(payload, ['data', 'media', 'url'])
    || pathValue(payload, ['data', 'data', 'media', 'url'])
  const token = pathValue(payload, ['data', 'media', 'url_token'])
    || pathValue(payload, ['data', 'data', 'media', 'url_token'])
  return typeof base === 'string' && typeof token === 'string' ? firstUrl(`${base}${token}`) : null
}

function extractWeChatDecodeKey(payload: unknown): string | null {
  const value = pathValue(payload, ['data', 'media', 'decode_key'])
    || pathValue(payload, ['data', 'data', 'media', 'decode_key'])
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

const TIKHUB_ENDPOINTS: Record<SupportedVideoPlatform, TikHubEndpoint> = {
  douyin: {
    path: '/api/v1/douyin/web/fetch_one_video_by_share_url',
    param: 'share_url',
    extract: extractDouyinMediaUrl,
  },
  bilibili: {
    path: '/api/v1/bilibili/web/fetch_video_playurl',
    param: 'bv_id',
    extract: extractBilibiliMediaUrl,
  },
  xiaohongshu: {
    path: '/api/v1/xiaohongshu/app_v2/get_video_note_detail',
    param: 'share_text',
    extract: (payload) => firstUrl(pathValue(payload, ['data', 'data', 'video', 'media', 'stream', 'h264', 0, 'master_url']))
      || firstUrl(pathValue(payload, ['data', 'items', 0, 'note_card', 'video', 'media', 'stream', 'h264', 0, 'master_url']))
      || firstUrl(pathValue(payload, ['data', 'items', 0, 'note_card', 'video', 'media', 'video_extra_info_encoded', 'media_video_info', 'video_url'])),
  },
  kuaishou: {
    path: '/api/v1/kuaishou/web/fetch_one_video_by_url',
    param: 'url',
    extract: (payload) => firstUrl(pathValue(payload, ['data', 'data', 'video', 'urls', 0]))
      || firstUrl(pathValue(payload, ['data', 'video', 'urls', 0])),
  },
  toutiao: {
    path: '/api/v1/toutiao/app/get_video_info',
    param: 'group_id',
    extract: (payload) => firstUrl(pathValue(payload, ['data', 'data', 'video_info', 'video_url']))
      || firstUrl(pathValue(payload, ['data', 'data', 'video_list', 'video_1', 'main_url']))
      || firstUrl(pathValue(payload, ['data', 'video_info', 'video_url'])),
  },
  weixin: {
    path: '/api/v1/wechat_channels/v2/fetch_video_detail',
    param: 'share_url',
    extract: extractWeChatMedia,
  },
  weibo: {
    path: '/api/v1/weibo/app/fetch_video_detail',
    param: 'mid',
    extract: (payload) => firstUrl(pathValue(payload, ['data', 'data', 'page_info', 'media_info', 'stream_url_hd']))
      || firstUrl(pathValue(payload, ['data', 'page_info', 'media_info', 'stream_url_hd']))
      || firstUrl(pathValue(payload, ['data', 'data', 'video_url'])),
  },
}

const DOUYIN_APP_FALLBACK: TikHubEndpoint = {
  path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
  param: 'share_url',
  extract: extractDouyinMediaUrl,
}

/** Explicit per-platform extraction prevents cover/avatar URLs from becoming media. */
export function extractTikHubMediaUrl(platform: string, payload: unknown): string | null {
  if (!SUPPORTED_PLATFORMS.has(platform)) return null
  return TIKHUB_ENDPOINTS[platform as SupportedVideoPlatform].extract(payload)
}

export function extractBvid(sourceUrl: string): string | null {
  return sourceUrl.match(/\b(BV[0-9A-Za-z]{10})\b/i)?.[1] || null
}

export function extractXiguaItemId(sourceUrl: string): string | null {
  const url = new URL(sourceUrl)
  return url.searchParams.get('item_id') || url.pathname.match(/\/(\d{10,})(?:\/|$)/)?.[1] || null
}

export function extractToutiaoGroupId(sourceUrl: string): string | null {
  const url = new URL(sourceUrl)
  return url.searchParams.get('group_id') || url.searchParams.get('item_id')
    || url.pathname.match(/\/(?:video|group)\/(\d+)(?:\/|$)/)?.[1] || null
}

export function extractWeiboMid(sourceUrl: string): string | null {
  const url = new URL(sourceUrl)
  return url.searchParams.get('mid') || url.pathname.match(/:(\d+)(?:\/|$)/)?.[1]
    || url.pathname.match(/\/(\d{10,})(?:\/|$)/)?.[1] || null
}

async function finalShareUrl(sourceUrl: string, fetcher: typeof safeVideoFetch): Promise<string> {
  const response = await fetcher(sourceUrl, { timeoutMs: 15_000, maxRedirects: MAX_REDIRECTS, maxResponseBytes: 512 * 1024 })
  const finalUrl = response.headers.get('x-hclite-final-url') || sourceUrl
  await response.body?.cancel().catch(() => undefined)
  return finalUrl
}

function apiRequest(endpoint: URL, pathName: string, params: Record<string, string>, extract: TikHubEndpoint['extract']): TikHubRequest {
  const url = new URL(pathName, endpoint)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return { url, extract }
}

async function buildTikHubRequests(
  input: { sourceUrl: string; platform: SupportedVideoPlatform; endpoint: URL },
  fetcher: typeof safeVideoFetch,
): Promise<TikHubRequest[]> {
  const primary = TIKHUB_ENDPOINTS[input.platform]
  if (input.platform === 'douyin') {
    return [primary, DOUYIN_APP_FALLBACK].map((item) => apiRequest(input.endpoint, item.path, { [item.param]: input.sourceUrl }, item.extract))
  }
  if (input.platform === 'xiaohongshu' || input.platform === 'kuaishou') {
    return [apiRequest(input.endpoint, primary.path, { [primary.param]: input.sourceUrl }, primary.extract)]
  }
  if (input.platform === 'weixin') {
    const url = new URL(primary.path, input.endpoint)
    return [{ url, method: 'POST', body: JSON.stringify({ share_url: input.sourceUrl, raw: false }), extract: primary.extract }]
  }
  let sourceUrl = input.sourceUrl
  if ((input.platform === 'bilibili' && !extractBvid(sourceUrl))
    || (input.platform === 'toutiao' && !extractXiguaItemId(sourceUrl) && !extractToutiaoGroupId(sourceUrl))
    || (input.platform === 'weibo' && !extractWeiboMid(sourceUrl))) {
    sourceUrl = await finalShareUrl(sourceUrl, fetcher)
  }
  if (input.platform === 'bilibili') {
    const bvid = extractBvid(sourceUrl)
    if (!bvid) throw new Error('无法从 B站分享链接识别 BV 号')
    // TikHub's parts endpoint supplies the CID required by its play-url endpoint.
    return [apiRequest(input.endpoint, '/api/v1/bilibili/web/fetch_video_parts', { bv_id: bvid }, () => null),
      apiRequest(input.endpoint, primary.path, { bv_id: bvid, cid: '__FROM_PREVIOUS__' }, primary.extract)]
  }
  if (input.platform === 'toutiao') {
    const host = normalizedHost(new URL(sourceUrl).hostname)
    if (host === 'ixigua.com' || host.endsWith('.ixigua.com')) {
      const itemId = extractXiguaItemId(sourceUrl)
      if (!itemId) throw new Error('无法从西瓜视频分享链接识别作品 ID')
      return [apiRequest(input.endpoint, '/api/v1/xigua/app/v2/fetch_one_video_play_url', { item_id: itemId }, (payload) =>
        firstUrl(pathValue(payload, ['data', 'data', 'video_url'])) || firstUrl(pathValue(payload, ['data', 'video_url']))
        || firstUrl(pathValue(payload, ['data', 'data'])))]
    }
    const groupId = extractToutiaoGroupId(sourceUrl)
    if (!groupId) throw new Error('无法从头条分享链接识别作品 ID')
    return [apiRequest(input.endpoint, primary.path, { group_id: groupId }, primary.extract)]
  }
  const mid = extractWeiboMid(sourceUrl)
  if (!mid) throw new Error('无法从微博分享链接识别视频 ID')
  return [apiRequest(input.endpoint, primary.path, { mid }, primary.extract)]
}

function tikhubStatusError(status: number): Error {
  if (status === 401) return new Error('TikHub API Key 无效或已过期，请检查设置')
  if (status === 402) return new Error('TikHub 账户余额不足，请充值后重试')
  if (status === 429) return new Error('TikHub 请求过于频繁，请稍后重试')
  return new Error(`视频链接解析失败 (HTTP ${status})`)
}

function tikhubUnavailableMessage(payload: unknown): string {
  const reason = String(pathValue(payload, ['data', 'filter_list', 0, 'reason']) ?? '')
  if (reason === '5') return '该内容为私密作品'
  if (reason === '8') return '该内容不可用、已删除或存在地区版权限制'
  if (reason === '10') return '该内容仅对部分用户可见'
  return 'TikHub 未返回可用视频地址，该内容可能是图文作品或暂不可访问'
}

/** Resolve through TikHub with an injectable safe fetcher for contract tests. */
export async function resolveTikHubMedia(
  input: {
    sourceUrl: string
    platform: SupportedVideoPlatform
    endpoint: URL
    apiKey: string
    options: Record<string, unknown>
  },
  fetcher: typeof safeVideoFetch = safeVideoFetch,
): Promise<{ mediaUrl: string; payload: unknown; decodeKey?: string }> {
  const attempts = await buildTikHubRequests(input, fetcher)
  let payload: unknown = null
  let mediaUrl: string | null = null
  for (let index = 0; index < attempts.length; index++) {
    const current = attempts[index]!
    if (current.url.searchParams.get('cid') === '__FROM_PREVIOUS__') {
      const cid = pathValue(payload, ['data', 'data', 'cid']) || pathValue(payload, ['data', 'cid'])
        || pathValue(payload, ['data', 'data', 0, 'cid']) || pathValue(payload, ['data', 0, 'cid'])
        || pathValue(payload, ['data', 'data', 'pages', 0, 'cid']) || pathValue(payload, ['data', 'pages', 0, 'cid'])
      if (typeof cid !== 'string' && typeof cid !== 'number') throw new Error('TikHub 未返回 B站视频 CID')
      current.url.searchParams.set('cid', String(cid))
    }
    const response = await fetcher(current.url.toString(), {
      timeoutMs: Number(input.options.timeout_ms) > 0 ? Number(input.options.timeout_ms) : 30_000,
      maxRedirects: Number(input.options.max_redirects) >= 0 ? Number(input.options.max_redirects) : 2,
      maxResponseBytes: 8 * 1024 * 1024,
      allowedDomains: allowedDomainsFromOptions(input.options, 'parser_allowlist'),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: 'application/json',
        ...(current.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'HCLite/1.0 video-parser',
      },
      method: current.method,
      body: current.body,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if (index + 1 < attempts.length && response.status >= 500) continue
      throw tikhubStatusError(response.status)
    }
    payload = await response.json().catch(() => null)
    const providerStatus = Number(pathValue(payload, ['code']) || 0)
    if ([401, 402, 429].includes(providerStatus)) throw tikhubStatusError(providerStatus)
    mediaUrl = payload ? current.extract(payload) : null
    if (mediaUrl) break
    if (input.platform === 'bilibili' && index === 0) continue
  }
  if (!mediaUrl || mediaUrl === input.sourceUrl) throw new Error(tikhubUnavailableMessage(payload))
  const decodeKey = input.platform === 'weixin' ? extractWeChatDecodeKey(payload) : null
  if (input.platform === 'weixin' && !decodeKey) throw new Error('TikHub 未返回视频号解密密钥')
  return { mediaUrl, payload, ...(decodeKey ? { decodeKey } : {}) }
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
  if (config.provider.trim().toLowerCase() !== 'tikhub') throw new Error('视频链接解析服务仅支持 TikHub')
  if (!config.apiKey?.trim()) throw new Error('视频链接解析服务 API Key 尚未配置')
  let endpoint: URL
  try { endpoint = new URL(config.endpoint) } catch { throw new Error('视频链接解析服务地址无效') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('视频链接解析服务地址无效')
  }
  const resolved = await resolveTikHubMedia({
    sourceUrl: canonicalSource,
    platform: platform as SupportedVideoPlatform,
    endpoint,
    apiKey: config.apiKey,
    options: config.options,
  })
  // Validate the returned address now, before the downloader follows it.
  const media = new URL(resolved.mediaUrl)
  if (!['http:', 'https:'].includes(media.protocol) || media.username || media.password) {
    throw new Error('视频链接解析服务返回了无效媒体地址')
  }
  return {
    sourceUrl: canonicalSource,
    mediaUrl: media.toString(),
    platform,
    title: findTitle(resolved.payload),
    metadata: {
      platform,
      parser: 'tikhub',
      mediaAllowlist: allowedDomainsFromOptions(config.options, 'media_allowlist'),
    },
    ...(resolved.decodeKey ? { decodeKey: resolved.decodeKey } : {}),
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
    if (source.decodeKey) await decryptWeChatMediaFile(filePath, source.decodeKey)
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
