import 'server-only'

import type { PoolClient } from 'pg'
import { query, withTransaction } from './db'

export const PRIVATE_PROFILE_LIMIT = 10
export const SYSTEM_PROFILE_LIMIT = 10
export const PRIVATE_SKILL_LIMIT = 10
export const SYSTEM_SKILL_LIMIT = 10
export const CATALOG_PAGE_DEFAULT = 20
export const CATALOG_PAGE_MAX = 50

export type ResourceKind = 'profile' | 'skill'
export type ResourceScope = 'private' | 'system'

export class CatalogQuotaError extends Error {
  readonly code = 'CATALOG_QUOTA_EXCEEDED'

  constructor(
    public readonly kind: ResourceKind,
    public readonly scope: ResourceScope,
    public readonly limit: number,
  ) {
    const label = kind === 'profile' ? '门店档案' : 'Skill'
    const scopeLabel = scope === 'system' ? 'system' : 'private'
    super(`${scopeLabel} ${label} limit is ${limit}`)
    this.name = 'CatalogQuotaError'
  }
}

function catalogTable(kind: ResourceKind): 'profiles' | 'skills' {
  return kind === 'profile' ? 'profiles' : 'skills'
}

function catalogLimit(kind: ResourceKind, scope: ResourceScope): number {
  if (kind === 'profile') return scope === 'system' ? SYSTEM_PROFILE_LIMIT : PRIVATE_PROFILE_LIMIT
  return scope === 'system' ? SYSTEM_SKILL_LIMIT : PRIVATE_SKILL_LIMIT
}

/**
 * Check a Skill/Profile quota while holding a lock that serializes creators.
 * Call this inside the same transaction as the eventual INSERT. Private
 * quotas lock the user's row; system quotas use a transaction advisory lock.
 */
export async function assertCatalogQuota(
  client: PoolClient,
  kind: ResourceKind,
  scope: ResourceScope,
  ownerId: string,
): Promise<void> {
  const table = catalogTable(kind)
  const limit = catalogLimit(kind, scope)
  if (scope === 'private') {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerId])
  } else {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hclite:${table}:system-quota`])
  }

  const result = scope === 'private'
    ? await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE owner_id = $1 AND scope = 'private'`,
      [ownerId],
    )
    : await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE scope = 'system'`,
    )
  if (Number(result.rows[0]?.count || 0) >= limit) {
    throw new CatalogQuotaError(kind, scope, limit)
  }
}

export function catalogQuotaResponse(error: unknown): { error: string; code: string; status: number } | null {
  if (!(error instanceof CatalogQuotaError)) return null
  return { error: error.message, code: error.code, status: 409 }
}

export function parseCatalogLimit(value: string | null): number {
  const parsed = Number(value || CATALOG_PAGE_DEFAULT)
  if (!Number.isInteger(parsed) || parsed < 1) return CATALOG_PAGE_DEFAULT
  return Math.min(parsed, CATALOG_PAGE_MAX)
}

export interface CatalogCursor {
  rank: 0 | 1
  createdAt: string
  id: string
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCatalogCursor(value: string | null): CatalogCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CatalogCursor>
    if ((parsed.rank !== 0 && parsed.rank !== 1) || !parsed.createdAt || !parsed.id) return null
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null
    return { rank: parsed.rank, createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id }
  } catch {
    return null
  }
}

export type LibraryVisibility = 'team' | 'private'
export type LibraryCategory = 'copy' | 'script' | 'topic'

export const LIBRARY_VISIBILITIES = ['team', 'private'] as const
export const LIBRARY_CATEGORIES = ['copy', 'script', 'topic'] as const

export function isLibraryVisibility(value: unknown): value is LibraryVisibility {
  return typeof value === 'string' && (LIBRARY_VISIBILITIES as readonly string[]).includes(value)
}

export function isLibraryCategory(value: unknown): value is LibraryCategory {
  return typeof value === 'string' && (LIBRARY_CATEGORIES as readonly string[]).includes(value)
}

export interface LibraryItemInput {
  visibility: LibraryVisibility
  category: LibraryCategory
  title: string
  summary?: string
  content: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface LibraryItemSummary {
  id: string
  creatorId: string
  visibility: LibraryVisibility
  category: LibraryCategory
  title: string
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
  contentLength: number
}

export interface LibraryItem extends LibraryItemSummary {
  content: string
  metadata: Record<string, unknown>
}

interface LibraryRow {
  id: string
  creator_id: string
  visibility: LibraryVisibility
  category: LibraryCategory
  title: string
  summary: string
  content: string
  tags: string[] | null
  metadata: Record<string, unknown> | string | null
  created_at: Date | string
  updated_at: Date | string
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function normalizeMetadata(value: LibraryRow['metadata']): Record<string, unknown> {
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

function toLibraryItem(row: LibraryRow): LibraryItem {
  const base: LibraryItemSummary = {
    id: row.id,
    creatorId: row.creator_id,
    visibility: row.visibility,
    category: row.category,
    title: row.title,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    contentLength: row.content.length,
  }
  return { ...base, content: row.content, metadata: normalizeMetadata(row.metadata) }
}

function toLibrarySummary(row: LibraryRow): LibraryItemSummary {
  return {
    id: row.id,
    creatorId: row.creator_id,
    visibility: row.visibility,
    category: row.category,
    title: row.title,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    contentLength: row.content.length,
  }
}

function libraryCursorSql(cursor: CatalogCursor | null, values: unknown[]): string {
  if (!cursor) return ''
  values.push(cursor.rank, cursor.createdAt, cursor.id)
  return `AND (
    CASE WHEN item.visibility = 'team' THEN 0 ELSE 1 END > $${values.length - 2}
    OR (CASE WHEN item.visibility = 'team' THEN 0 ELSE 1 END = $${values.length - 2}
      AND item.created_at < $${values.length - 1}::timestamptz)
    OR (CASE WHEN item.visibility = 'team' THEN 0 ELSE 1 END = $${values.length - 2}
      AND item.created_at = $${values.length - 1}::timestamptz
      AND item.id < $${values.length})
  )`
}

export async function listLibrarySummaries(input: {
  userId: string
  limit: number
  cursor?: CatalogCursor | null
  category?: LibraryCategory | null
}): Promise<{ items: LibraryItemSummary[]; hasMore: boolean; nextCursor: string | null }> {
  const values: unknown[] = [input.userId]
  let categorySql = ''
  if (input.category) {
    values.push(input.category)
    categorySql = `AND item.category = $${values.length}`
  }
  const cursorSql = libraryCursorSql(input.cursor || null, values)
  values.push(input.limit + 1)
  const limitParam = values.length
  const result = await query<LibraryRow>(
    `SELECT item.id, item.creator_id, item.visibility, item.category, item.title,
            item.summary, item.content, item.tags, item.created_at, item.updated_at,
            item.metadata
       FROM library_items AS item
      WHERE (item.visibility = 'team' OR item.creator_id = $1)
        ${categorySql} ${cursorSql}
      ORDER BY CASE WHEN item.visibility = 'team' THEN 0 ELSE 1 END,
               item.created_at DESC, item.id DESC
      LIMIT $${limitParam}`,
    values,
  )
  const hasMore = result.rows.length > input.limit
  const rows = result.rows.slice(0, input.limit)
  const last = rows.at(-1)
  const nextCursor = hasMore && last
    ? encodeCatalogCursor({
      rank: last.visibility === 'team' ? 0 : 1,
      createdAt: last.created_at instanceof Date ? last.created_at.toISOString() : new Date(last.created_at).toISOString(),
      id: last.id,
    })
    : null
  return { items: rows.map(toLibrarySummary), hasMore, nextCursor }
}

export async function getLibraryItem(id: string, userId: string): Promise<LibraryItem | null> {
  const result = await query<LibraryRow>(
    `SELECT id, creator_id, visibility, category, title, summary, content, tags,
            metadata, created_at, updated_at
       FROM library_items
      WHERE id = $1 AND (visibility = 'team' OR creator_id = $2)
      LIMIT 1`,
    [id, userId],
  )
  const row = result.rows[0]
  return row ? toLibraryItem(row) : null
}

export async function createLibraryItem(id: string, creatorId: string, input: LibraryItemInput): Promise<LibraryItem> {
  const result = await query<LibraryRow>(
    `INSERT INTO library_items
      (id, creator_id, visibility, category, title, summary, content, tags, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING id, creator_id, visibility, category, title, summary, content, tags,
               metadata, created_at, updated_at`,
    [
      id,
      creatorId,
      input.visibility,
      input.category,
      input.title,
      input.summary || '',
      input.content,
      input.tags || [],
      JSON.stringify(input.metadata || {}),
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Library item was not created')
  return toLibraryItem(row)
}

/** Import a batch atomically so a validation/database error never leaves a partial library. */
export async function createLibraryItems(
  items: Array<{ id: string; creatorId: string; input: LibraryItemInput }>,
): Promise<LibraryItem[]> {
  return withTransaction(async (client) => {
    const created: LibraryItem[] = []
    for (const item of items) {
      const result = await client.query<LibraryRow>(
        `INSERT INTO library_items
          (id, creator_id, visibility, category, title, summary, content, tags, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         RETURNING id, creator_id, visibility, category, title, summary, content, tags,
                   metadata, created_at, updated_at`,
        [item.id, item.creatorId, item.input.visibility, item.input.category, item.input.title,
          item.input.summary || '', item.input.content, item.input.tags || [],
          JSON.stringify(item.input.metadata || {})],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Library item was not created')
      created.push(toLibraryItem(row))
    }
    return created
  })
}

export interface LibraryItemPatch {
  visibility?: LibraryVisibility
  category?: LibraryCategory
  title?: string
  summary?: string
  content?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Update a library item with the permission check in SQL. The owner can
 * manage team rows, while a private row can only ever be managed by its
 * creator; this deliberately prevents an owner from reading/editing a
 * member's private material.
 */
export async function updateLibraryItem(
  id: string,
  userId: string,
  isOwner: boolean,
  patch: LibraryItemPatch,
): Promise<LibraryItem | null> {
  const columns: string[] = []
  const values: unknown[] = [id, userId, isOwner]
  const add = (column: string, value: unknown, cast = '') => {
    values.push(value)
    columns.push(`${column} = $${values.length}${cast}`)
  }
  if (patch.visibility !== undefined) add('visibility', patch.visibility)
  if (patch.category !== undefined) add('category', patch.category)
  if (patch.title !== undefined) add('title', patch.title)
  if (patch.summary !== undefined) add('summary', patch.summary)
  if (patch.content !== undefined) add('content', patch.content)
  if (patch.tags !== undefined) add('tags', patch.tags)
  if (patch.metadata !== undefined) add('metadata', JSON.stringify(patch.metadata), '::jsonb')
  if (!columns.length) throw new Error('No library fields to update')
  const result = await query<LibraryRow>(
    `UPDATE library_items
        SET ${columns.join(', ')}, updated_at = now()
      WHERE id = $1
        AND ((visibility = 'team' AND (creator_id = $2 OR $3::boolean))
          OR (visibility = 'private' AND creator_id = $2))
      RETURNING id, creator_id, visibility, category, title, summary, content, tags,
                metadata, created_at, updated_at`,
    values,
  )
  const row = result.rows[0]
  return row ? toLibraryItem(row) : null
}

export async function deleteLibraryItem(id: string, userId: string, isOwner: boolean): Promise<boolean> {
  const result = await query(
    `DELETE FROM library_items
      WHERE id = $1
        AND ((visibility = 'team' AND (creator_id = $2 OR $3::boolean))
          OR (visibility = 'private' AND creator_id = $2))`,
    [id, userId, isOwner],
  )
  return (result.rowCount || 0) > 0
}
