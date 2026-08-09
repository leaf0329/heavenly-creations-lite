import 'server-only'

import { randomUUID } from 'node:crypto'
import { createJob, type JobRecord } from './jobs'
import { getStoredServiceConfig } from './service-config'
import { query, withTransaction } from './db'
import { getLibraryItem } from './catalog'
import { TEXT_JOB_TYPES, type TextJobType } from './features'

/**
 * The Agent is intentionally narrower than the rest of the product.  These
 * six values are the only task types that may be submitted by an Agent chat.
 * In particular, `stt` is an entry point to the transcription area, not an
 * Agent task, and no media/visual/billing capability is exposed here.
 */
export const AGENT_TASK_TYPES = TEXT_JOB_TYPES
export type AgentTaskType = TextJobType

export const AGENT_ASSET_SELECTION_NOTICE = '本对话不再弹出选择，直接使用当前已选择资产'

export const AGENT_INTENTS = [
  'copywriting',
  'transcription-entry',
  'library-search',
  'web-search',
] as const
export type AgentIntent = (typeof AGENT_INTENTS)[number]

export const AGENT_ALLOWED_CAPABILITIES = [
  '六类文案任务',
  '视频转写入口',
  '信息库检索',
  '可选联网搜索',
] as const

export const AGENT_FORBIDDEN_CAPABILITIES = [
  'image-generation',
  'visual-generation',
  'cover-generation',
  'billing',
] as const

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface AgentConversationSummary {
  id: string
  userId: string
  title: string
  messageCount: number
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentMessage {
  id: string
  conversationId: string
  userId: string
  role: AgentMessageRole
  content: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AgentConversation extends AgentConversationSummary {
  messages: AgentMessage[]
  assetSelection: AgentAssetSelectionStatus
}

export interface AgentAssetSelection {
  skillIds: string[]
  profileIds: string[]
  libraryItemIds: string[]
}

export interface AgentAssetSelectionStatus extends AgentAssetSelection {
  confirmed: boolean
  source: 'confirmed' | 'default' | 'none'
  requiresAssetSelection: boolean
  notice?: string
  available?: AgentSelectableAssets
}

export interface AgentSelectableAsset {
  id: string
  name: string
  summary: string
  scope?: 'system' | 'private' | 'team'
  category?: string
}

export interface AgentSelectableAssets {
  skills: AgentSelectableAsset[]
  profiles: AgentSelectableAsset[]
  libraryItems: AgentSelectableAsset[]
}

interface AgentConversationRow {
  id: string
  user_id: string
  title: string
  message_count?: number | string
  last_message_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface AgentMessageRow {
  id: string
  conversation_id: string
  user_id: string
  role: AgentMessageRole
  content: string
  metadata: Record<string, unknown> | string | null
  created_at: Date | string
}

interface AgentAssetRow {
  conversation_id: string
  user_id: string
  skill_ids: string[] | null
  profile_ids: string[] | null
  library_item_ids: string[] | null
  confirmed: boolean
}

interface SelectableRow {
  id: string
  name: string
  summary: string
  scope?: 'system' | 'private' | 'team'
  category?: string
}

function isoDate(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function objectValue(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
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

function toConversationSummary(row: AgentConversationRow): AgentConversationSummary {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || '',
    messageCount: Number(row.message_count || 0),
    lastMessageAt: isoDate(row.last_message_at),
    createdAt: isoDate(row.created_at) || new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) || new Date(0).toISOString(),
  }
}

function toMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    metadata: objectValue(row.metadata),
    createdAt: isoDate(row.created_at) || new Date(0).toISOString(),
  }
}

function ids(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) continue
    const normalized = id.toLowerCase()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
    if (result.length >= max) break
  }
  return result
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeAgentAssetSelection(value: unknown): AgentAssetSelection {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    skillIds: ids(input.skillIds ?? input.skills),
    profileIds: ids(input.profileIds ?? input.profiles),
    libraryItemIds: ids(input.libraryItemIds ?? input.libraryItems),
  }
}

export function isAgentTaskType(value: unknown): value is AgentTaskType {
  return typeof value === 'string' && (AGENT_TASK_TYPES as readonly string[]).includes(value)
}

export function isAgentIntent(value: unknown): value is AgentIntent {
  return typeof value === 'string' && (AGENT_INTENTS as readonly string[]).includes(value)
}

/** Returns a stable capability label for UI error handling. */
export function prohibitedAgentCapability(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (['image', 'image-generation', 'generate-image', '生图', '图片生成'].includes(normalized)) return 'image-generation'
  if (['visual', 'visual-generation', '视觉', '视觉生成'].includes(normalized)) return 'visual-generation'
  if (['cover', 'cover-generation', '封面', '封面生成'].includes(normalized)) return 'cover-generation'
  if (['billing', '计费', '套餐', '金豆', '额度'].includes(normalized)) return 'billing'
  return null
}

export class AgentNotFoundError extends Error {
  readonly code = 'AGENT_NOT_FOUND'

  constructor(message = '对话不存在') {
    super(message)
    this.name = 'AgentNotFoundError'
  }
}

export class AgentAssetSelectionError extends Error {
  readonly code = 'AGENT_ASSET_SELECTION_INVALID'
  readonly missing: AgentAssetSelection

  constructor(missing: AgentAssetSelection) {
    super('选择的 Skill、门店档案或信息库条目不可用')
    this.name = 'AgentAssetSelectionError'
    this.missing = missing
  }
}

export async function createAgentConversation(userId: string, title = '', id = randomUUID()): Promise<AgentConversationSummary> {
  const result = await query<AgentConversationRow>(
    `INSERT INTO agent_conversations (id, user_id, title)
     VALUES ($1, $2, $3)
     RETURNING id::text AS id, user_id::text AS user_id, title,
               0::int AS message_count, NULL::timestamptz AS last_message_at,
               created_at, updated_at`,
    [id, userId, text(title, 200)],
  )
  const row = result.rows[0]
  if (!row) throw new Error('对话创建失败')
  return toConversationSummary(row)
}

export async function listAgentConversations(userId: string, limit = 50): Promise<AgentConversationSummary[]> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 50
  const result = await query<AgentConversationRow>(
    `SELECT conversation.id::text AS id, conversation.user_id::text AS user_id,
            conversation.title,
            COUNT(message.id)::int AS message_count,
            MAX(message.created_at) AS last_message_at,
            conversation.created_at, conversation.updated_at
       FROM agent_conversations AS conversation
       LEFT JOIN agent_messages AS message
         ON message.conversation_id = conversation.id
        AND message.user_id = $1
      WHERE conversation.user_id = $1
      GROUP BY conversation.id
      ORDER BY conversation.updated_at DESC, conversation.id DESC
      LIMIT $2`,
    [userId, safeLimit],
  )
  return result.rows.map(toConversationSummary)
}

export async function getAgentConversationForUser(id: string, userId: string): Promise<AgentConversationSummary | null> {
  const result = await query<AgentConversationRow>(
    `SELECT conversation.id::text AS id, conversation.user_id::text AS user_id,
            conversation.title,
            (SELECT COUNT(*)::int FROM agent_messages AS message
              WHERE message.conversation_id = conversation.id
                AND message.user_id = $2) AS message_count,
            (SELECT MAX(message.created_at) FROM agent_messages AS message
              WHERE message.conversation_id = conversation.id
                AND message.user_id = $2) AS last_message_at,
            conversation.created_at, conversation.updated_at
       FROM agent_conversations AS conversation
      WHERE conversation.id = $1 AND conversation.user_id = $2
      LIMIT 1`,
    [id, userId],
  )
  return result.rows[0] ? toConversationSummary(result.rows[0]) : null
}

export async function updateAgentConversationTitle(id: string, userId: string, title: string): Promise<AgentConversationSummary | null> {
  const result = await query<AgentConversationRow>(
    `UPDATE agent_conversations
        SET title = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id::text AS id, user_id::text AS user_id, title,
                (SELECT COUNT(*)::int FROM agent_messages AS message
                  WHERE message.conversation_id = agent_conversations.id
                    AND message.user_id = $2) AS message_count,
                (SELECT MAX(message.created_at) FROM agent_messages AS message
                  WHERE message.conversation_id = agent_conversations.id
                    AND message.user_id = $2) AS last_message_at,
                created_at, updated_at`,
    [id, userId, text(title, 200)],
  )
  return result.rows[0] ? toConversationSummary(result.rows[0]) : null
}

export async function deleteAgentConversation(id: string, userId: string): Promise<boolean> {
  const result = await query('DELETE FROM agent_conversations WHERE id = $1 AND user_id = $2', [id, userId])
  return (result.rowCount || 0) > 0
}

export async function listAgentMessages(conversationId: string, userId: string, limit = 200): Promise<AgentMessage[]> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 200
  const result = await query<AgentMessageRow>(
    `SELECT message.id::text AS id, message.conversation_id::text AS conversation_id,
            message.user_id::text AS user_id, message.role, message.content,
            message.metadata, message.created_at
       FROM agent_messages AS message
       JOIN agent_conversations AS conversation
         ON conversation.id = message.conversation_id
        AND conversation.user_id = $2
      WHERE message.conversation_id = $1 AND message.user_id = $2
      ORDER BY message.created_at ASC, message.id ASC
      LIMIT $3`,
    [conversationId, userId, safeLimit],
  )
  return result.rows.map(toMessage)
}

export async function appendAgentMessage(input: {
  conversationId: string
  userId: string
  role: AgentMessageRole
  content: string
  metadata?: Record<string, unknown>
}): Promise<AgentMessage | null> {
  const content = text(input.content, 200_000)
  if (!content) throw new Error('消息内容不得为空')
  const result = await query<AgentMessageRow>(
    `INSERT INTO agent_messages (id, conversation_id, user_id, role, content, metadata)
     SELECT $1, conversation.id, $2, $3, $4, $5::jsonb
       FROM agent_conversations AS conversation
      WHERE conversation.id = $6 AND conversation.user_id = $2
     RETURNING id::text AS id, conversation_id::text AS conversation_id,
               user_id::text AS user_id, role, content, metadata, created_at`,
    [randomUUID(), input.userId, input.role, content, JSON.stringify(input.metadata || {}), input.conversationId],
  )
  if (!result.rows[0]) return null
  // Keep list ordering useful even when a worker only writes a job result.
  await query(
    'UPDATE agent_conversations SET updated_at = now() WHERE id = $1 AND user_id = $2',
    [input.conversationId, input.userId],
  )
  return toMessage(result.rows[0])
}

async function readableAssetIds(userId: string, selection: AgentAssetSelection): Promise<AgentAssetSelection> {
  const [skills, profiles, libraryItems] = await Promise.all([
    query<{ id: string }>(
      `SELECT id::text AS id FROM skills
        WHERE id = ANY($1::uuid[])
          AND (scope = 'system' OR (scope = 'private' AND owner_id = $2))`,
      [selection.skillIds, userId],
    ),
    query<{ id: string }>(
      `SELECT id::text AS id FROM profiles
        WHERE id = ANY($1::uuid[])
          AND (scope = 'system' OR (scope = 'private' AND owner_id = $2))`,
      [selection.profileIds, userId],
    ),
    query<{ id: string }>(
      `SELECT id::text AS id FROM library_items
        WHERE id = ANY($1::uuid[])
          AND (visibility = 'team' OR (visibility = 'private' AND creator_id = $2))`,
      [selection.libraryItemIds, userId],
    ),
  ])
  return {
    skillIds: skills.rows.map((row) => row.id.toLowerCase()),
    profileIds: profiles.rows.map((row) => row.id.toLowerCase()),
    libraryItemIds: libraryItems.rows.map((row) => row.id.toLowerCase()),
  }
}

function difference(wanted: string[], readable: string[]): string[] {
  const available = new Set(readable.map((value) => value.toLowerCase()))
  return wanted.filter((value) => !available.has(value.toLowerCase()))
}

/** Validate scopes before any confirmed IDs are persisted. */
export async function validateAgentAssetSelection(userId: string, value: unknown): Promise<AgentAssetSelection> {
  const selection = normalizeAgentAssetSelection(value)
  const readable = await readableAssetIds(userId, selection)
  const missing: AgentAssetSelection = {
    skillIds: difference(selection.skillIds, readable.skillIds),
    profileIds: difference(selection.profileIds, readable.profileIds),
    libraryItemIds: difference(selection.libraryItemIds, readable.libraryItemIds),
  }
  if (missing.skillIds.length || missing.profileIds.length || missing.libraryItemIds.length) {
    throw new AgentAssetSelectionError(missing)
  }
  return selection
}

export async function confirmAgentAssetSelection(
  conversationId: string,
  userId: string,
  value: unknown,
): Promise<AgentAssetSelectionStatus> {
  const selection = await validateAgentAssetSelection(userId, value)
  const result = await withTransaction(async (client) => {
    const conversation = await client.query<{ id: string }>(
      `SELECT id FROM agent_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [conversationId, userId],
    )
    if (!conversation.rows[0]) throw new AgentNotFoundError()
    const upserted = await client.query<AgentAssetRow>(
      `INSERT INTO agent_conversation_assets
        (conversation_id, user_id, skill_ids, profile_ids, library_item_ids, confirmed, confirmed_at, updated_at)
       VALUES ($1, $2, $3::uuid[], $4::uuid[], $5::uuid[], true, now(), now())
       ON CONFLICT (conversation_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         skill_ids = EXCLUDED.skill_ids,
         profile_ids = EXCLUDED.profile_ids,
         library_item_ids = EXCLUDED.library_item_ids,
         confirmed = true,
         confirmed_at = now(),
         updated_at = now()
       WHERE agent_conversation_assets.user_id = $2
       RETURNING conversation_id::text AS conversation_id, user_id::text AS user_id,
                 skill_ids, profile_ids, library_item_ids, confirmed`,
      [conversationId, userId, selection.skillIds, selection.profileIds, selection.libraryItemIds],
    )
    if (!upserted.rows[0]) throw new AgentNotFoundError()
    return upserted.rows[0]
  })
  return {
    skillIds: Array.isArray(result.skill_ids) ? result.skill_ids.map(String) : [],
    profileIds: Array.isArray(result.profile_ids) ? result.profile_ids.map(String) : [],
    libraryItemIds: Array.isArray(result.library_item_ids) ? result.library_item_ids.map(String) : [],
    confirmed: Boolean(result.confirmed),
    source: 'confirmed',
    requiresAssetSelection: false,
    notice: AGENT_ASSET_SELECTION_NOTICE,
  }
}

async function getConfirmedAssetSelection(conversationId: string, userId: string): Promise<AgentAssetSelectionStatus | null> {
  const result = await query<AgentAssetRow>(
    `SELECT assets.conversation_id::text AS conversation_id, assets.user_id::text AS user_id,
            assets.skill_ids, assets.profile_ids, assets.library_item_ids, assets.confirmed
       FROM agent_conversation_assets AS assets
       JOIN agent_conversations AS conversation
         ON conversation.id = assets.conversation_id
        AND conversation.user_id = $2
      WHERE assets.conversation_id = $1 AND assets.user_id = $2
      LIMIT 1`,
    [conversationId, userId],
  )
  const row = result.rows[0]
  if (!row || !row.confirmed) return null
  return {
    skillIds: Array.isArray(row.skill_ids) ? row.skill_ids.map(String) : [],
    profileIds: Array.isArray(row.profile_ids) ? row.profile_ids.map(String) : [],
    libraryItemIds: Array.isArray(row.library_item_ids) ? row.library_item_ids.map(String) : [],
    confirmed: Boolean(row.confirmed),
    source: 'confirmed',
    requiresAssetSelection: false,
    notice: AGENT_ASSET_SELECTION_NOTICE,
  }
}

async function getDefaultAssetSelection(userId: string): Promise<AgentAssetSelection> {
  // Skills intentionally have no default column in the catalog schema.  A
  // system/private Profile marked default is the only automatic asset.
  const result = await query<{ id: string }>(
    `SELECT id::text AS id FROM profiles
      WHERE is_default = true
        AND (scope = 'system' OR (scope = 'private' AND owner_id = $1))
      ORDER BY CASE WHEN scope = 'private' THEN 0 ELSE 1 END,
               updated_at DESC, id DESC`,
    [userId],
  )
  return { skillIds: [], profileIds: result.rows.map((row) => row.id), libraryItemIds: [] }
}

export async function listAgentSelectableAssets(userId: string): Promise<AgentSelectableAssets> {
  const [skills, profiles, libraryItems] = await Promise.all([
    query<SelectableRow>(
      `SELECT id::text AS id, name, summary, scope
         FROM skills
        WHERE enabled = true AND (scope = 'system' OR (scope = 'private' AND owner_id = $1))
        ORDER BY CASE WHEN scope = 'system' THEN 0 ELSE 1 END, updated_at DESC, id DESC
        LIMIT 100`,
      [userId],
    ),
    query<SelectableRow>(
      `SELECT id::text AS id, name, summary, scope
         FROM profiles
        WHERE scope = 'system' OR (scope = 'private' AND owner_id = $1)
        ORDER BY CASE WHEN scope = 'system' THEN 0 ELSE 1 END, updated_at DESC, id DESC
        LIMIT 100`,
      [userId],
    ),
    query<SelectableRow>(
      `SELECT id::text AS id, title AS name, summary, visibility AS scope, category
         FROM library_items
        WHERE visibility = 'team' OR (visibility = 'private' AND creator_id = $1)
        ORDER BY updated_at DESC, id DESC
        LIMIT 100`,
      [userId],
    ),
  ])
  return {
    skills: skills.rows.map((row) => ({ id: row.id, name: row.name, summary: row.summary || '', scope: row.scope })),
    profiles: profiles.rows.map((row) => ({ id: row.id, name: row.name, summary: row.summary || '', scope: row.scope })),
    libraryItems: libraryItems.rows.map((row) => ({ id: row.id, name: row.name, summary: row.summary || '', scope: row.scope, category: row.category })),
  }
}

/**
 * Resolve the selection used by a message.  Confirmed values always win over
 * defaults, including an explicitly confirmed empty set.  The available list
 * is only returned when a UI must show the selection dialog.
 */
export async function getAgentAssetSelectionStatus(conversationId: string, userId: string): Promise<AgentAssetSelectionStatus> {
  const conversation = await getAgentConversationForUser(conversationId, userId)
  if (!conversation) throw new AgentNotFoundError()
  const confirmed = await getConfirmedAssetSelection(conversationId, userId)
  if (confirmed) return confirmed
  const defaults = await getDefaultAssetSelection(userId)
  const hasDefault = defaults.skillIds.length > 0 || defaults.profileIds.length > 0 || defaults.libraryItemIds.length > 0
  if (hasDefault) {
    return { ...defaults, confirmed: false, source: 'default', requiresAssetSelection: false }
  }
  return {
    skillIds: [], profileIds: [], libraryItemIds: [],
    confirmed: false,
    source: 'none',
    requiresAssetSelection: true,
    available: await listAgentSelectableAssets(userId),
  }
}

export async function getAgentAssetContext(userId: string, selection: AgentAssetSelection): Promise<string> {
  const sections: string[] = []
  if (selection.skillIds.length) {
    const result = await query<{ name: string; content: string }>(
      `SELECT name, content FROM skills
        WHERE id = ANY($1::uuid[])
          AND (scope = 'system' OR (scope = 'private' AND owner_id = $2))
        ORDER BY id`,
      [selection.skillIds, userId],
    )
    if (result.rows.length) sections.push(`Skill：\n${result.rows.map((row) => `${row.name}\n${row.content}`).join('\n\n').slice(0, 60_000)}`)
  }
  if (selection.profileIds.length) {
    const result = await query<{ name: string; content: string }>(
      `SELECT name, content FROM profiles
        WHERE id = ANY($1::uuid[])
          AND (scope = 'system' OR (scope = 'private' AND owner_id = $2))
        ORDER BY id`,
      [selection.profileIds, userId],
    )
    if (result.rows.length) sections.push(`门店档案：\n${result.rows.map((row) => `${row.name}\n${row.content}`).join('\n\n').slice(0, 60_000)}`)
  }
  for (const id of selection.libraryItemIds.slice(0, 20)) {
    const item = await getLibraryItem(id, userId)
    if (item) sections.push(`信息库：${item.title}\n${item.content.slice(0, 20_000)}`)
  }
  return sections.join('\n\n').slice(0, 120_000)
}

/**
 * Build an Agent prompt without inventing output constraints.  The user's
 * instruction is kept verbatim (apart from outer whitespace); asset context
 * is appended as reference material only.  No format, shot, subtitle,
 * duration, or word-count instruction is injected here.
 */
export function buildAgentPrompt(instruction: string, assetContext = ''): string {
  const cleanInstruction = text(instruction, 20_000)
  if (!cleanInstruction) throw new Error('创作指令不得为空')
  const context = text(assetContext, 120_000)
  return context ? `${cleanInstruction}\n\n参考资产（仅供参考）：\n${context}` : cleanInstruction
}

export function inferAgentTaskType(instruction: string): AgentTaskType {
  const value = instruction.toLowerCase()
  if (value.includes('小红书') || value.includes('种草笔记')) return 'xiaohongshu-copy'
  if (value.includes('朋友圈')) return 'moments-copy'
  if (value.includes('成交') || value.includes('销售') || value.includes('话术')) return 'sales-script'
  if (value.includes('拆解') || value.includes('仿写') || value.includes('转写')) return 'stt-rewrite'
  if (value.includes('选题') || value.includes('主题规划')) return 'topic-plan'
  return 'topics'
}

export interface AgentWebSearchResult {
  title: string
  url: string
  snippet?: string
}

export interface AgentWebSearchInput {
  query: string
  userId: string
  conversationId?: string
}

export type AgentWebSearchProvider = (input: AgentWebSearchInput) => Promise<AgentWebSearchResult[]>

let webSearchProvider: AgentWebSearchProvider | null = null

/** Inject a provider from the deployment; no external API is assumed here. */
export function setAgentWebSearchProvider(provider: AgentWebSearchProvider | null): void {
  webSearchProvider = provider
}

export function isAgentWebSearchEnabled(options: Record<string, unknown> | null | undefined): boolean {
  return options?.webSearchEnabled === true
}

export async function searchAgentWeb(input: AgentWebSearchInput): Promise<{
  enabled: boolean
  available: boolean
  results: AgentWebSearchResult[]
}> {
  const config = await getStoredServiceConfig('agent')
  const enabled = Boolean(config?.enabled) && isAgentWebSearchEnabled(config?.options)
  if (!enabled || !webSearchProvider) return { enabled, available: false, results: [] }
  try {
    const results = await webSearchProvider({ ...input, query: text(input.query, 500) })
    return { enabled: true, available: true, results: Array.isArray(results) ? results.slice(0, 20) : [] }
  } catch {
    // A provider failure must not turn into an accidental network fallback.
    return { enabled: true, available: false, results: [] }
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export async function searchAgentLibrary(userId: string, search: string, limit = 20) {
  const queryText = text(search, 200)
  if (!queryText) return []
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 20
  const pattern = `%${escapeLike(queryText)}%`
  const result = await query<{
    id: string
    creator_id: string
    visibility: 'team' | 'private'
    category: string
    title: string
    summary: string
    content: string
    tags: string[] | null
    created_at: Date | string
    updated_at: Date | string
  }>(
    `SELECT id::text AS id, creator_id::text AS creator_id, visibility, category,
            title, summary, content, tags, created_at, updated_at
       FROM library_items
      WHERE (visibility = 'team' OR (visibility = 'private' AND creator_id = $1))
        AND (title ILIKE $2 ESCAPE '\\'
          OR summary ILIKE $2 ESCAPE '\\'
          OR content ILIKE $2 ESCAPE '\\'
          OR array_to_string(tags, ' ') ILIKE $2 ESCAPE '\\')
      ORDER BY updated_at DESC, id DESC
      LIMIT $3`,
    [userId, pattern, safeLimit],
  )
  return result.rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    visibility: row.visibility,
    category: row.category,
    title: row.title,
    summary: row.summary || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    content: row.content,
    createdAt: isoDate(row.created_at) || new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) || new Date(0).toISOString(),
  }))
}

export interface ProcessAgentMessageInput {
  conversationId: string
  userId: string
  content: string
  taskType?: unknown
  intent?: unknown
  assetSelection?: unknown
  confirmAssets?: boolean
  searchQuery?: string
}

export type ProcessAgentMessageResult =
  | { kind: 'requires-asset-selection'; selection: AgentAssetSelectionStatus }
  | { kind: 'transcription-entry'; href: string }
  | { kind: 'library-search'; results: Awaited<ReturnType<typeof searchAgentLibrary>> }
  | { kind: 'web-search'; result: Awaited<ReturnType<typeof searchAgentWeb>> }
  | { kind: 'job'; message: AgentMessage; job: JobRecord; taskType: AgentTaskType; selection: AgentAssetSelectionStatus }

/** Shared workflow used by the REST routes, keeping authorization decisions in one place. */
export async function processAgentMessage(input: ProcessAgentMessageInput): Promise<ProcessAgentMessageResult> {
  const content = text(input.content, 20_000)
  if (!content) throw new Error('消息内容不得为空')
  if (!await getAgentConversationForUser(input.conversationId, input.userId)) throw new AgentNotFoundError()

  const intent = input.intent === undefined || input.intent === null || input.intent === ''
    ? 'copywriting'
    : input.intent
  if (!isAgentIntent(intent)) {
    const capability = prohibitedAgentCapability(intent) || String(intent)
    throw new Error(`Agent 不支持该能力：${capability}`)
  }
  if (intent === 'transcription-entry') return { kind: 'transcription-entry', href: '/transcribe' }
  if (intent === 'library-search') {
    return { kind: 'library-search', results: await searchAgentLibrary(input.userId, input.searchQuery || content) }
  }
  if (intent === 'web-search') {
    return {
      kind: 'web-search',
      result: await searchAgentWeb({ query: input.searchQuery || content, userId: input.userId, conversationId: input.conversationId }),
    }
  }

  if (input.taskType !== undefined && input.taskType !== null && input.taskType !== '' && !isAgentTaskType(input.taskType)) {
    throw new Error(`Agent 不支持该文案任务：${String(input.taskType)}`)
  }
  let selection: AgentAssetSelectionStatus
  if (input.confirmAssets) {
    selection = await confirmAgentAssetSelection(input.conversationId, input.userId, input.assetSelection || {})
  } else {
    selection = await getAgentAssetSelectionStatus(input.conversationId, input.userId)
  }
  if (selection.requiresAssetSelection) return { kind: 'requires-asset-selection', selection }

  const taskType = (isAgentTaskType(input.taskType) ? input.taskType : inferAgentTaskType(content)) as AgentTaskType
  const assetContext = await getAgentAssetContext(input.userId, selection)
  const prompt = buildAgentPrompt(content, assetContext)
  const message = await appendAgentMessage({
    conversationId: input.conversationId,
    userId: input.userId,
    role: 'user',
    content,
    metadata: { intent, taskType, assetSelection: selection },
  })
  if (!message) throw new AgentNotFoundError()
  const job = await createJob({
    userId: input.userId,
    type: taskType,
    title: content.slice(0, 200),
    input: {
      prompt,
      instruction: content,
      taskType,
      conversationId: input.conversationId,
      messageId: message.id,
      skillIds: selection.skillIds,
      profileIds: selection.profileIds,
      libraryItemIds: selection.libraryItemIds,
      outputMode: 'text',
    },
  })
  // Queue startup is best-effort: API callers still receive the durable job
  // if a local worker is not available in the current process.
  try {
    const { enqueueJob } = await import('./job-queue')
    enqueueJob()
  } catch (error) {
    console.error('[agent/job] queue start failed', error instanceof Error ? error.message : 'unknown error')
  }
  return { kind: 'job', message, job, taskType, selection }
}
