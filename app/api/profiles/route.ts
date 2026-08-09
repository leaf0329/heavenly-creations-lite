import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireUser } from '@/lib/auth'
import { query, withTransaction } from '@/lib/db'
import {
  assertCatalogQuota,
  catalogQuotaResponse,
  decodeCatalogCursor,
  encodeCatalogCursor,
  parseCatalogLimit,
  PRIVATE_PROFILE_LIMIT,
  SYSTEM_PROFILE_LIMIT,
} from '@/lib/catalog'

export const dynamic = 'force-dynamic'

const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  summary: z.string().max(500).optional().default(''),
  content: z.string().trim().min(1).max(100_000),
  isDefault: z.boolean().optional().default(false),
  scope: z.enum(['system', 'private']).optional().default('private'),
}).strict()

type ProfileRow = {
  id: string
  owner_id: string
  scope: 'system' | 'private'
  name: string
  summary: string
  content: string
  is_default: boolean
  created_at: Date | string
  updated_at: Date | string
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function detail(row: ProfileRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    scope: row.scope,
    name: row.name,
    summary: row.summary,
    content: row.content,
    isDefault: row.is_default,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function summary(row: ProfileRow) {
  const result = detail(row)
  const { content, ...withoutContent } = result
  return { ...withoutContent, contentLength: content.length }
}

function cursorSql(cursor: ReturnType<typeof decodeCatalogCursor>, values: unknown[]): string {
  if (!cursor) return ''
  values.push(cursor.rank, cursor.createdAt, cursor.id)
  const rank = values.length - 2
  const createdAt = values.length - 1
  const id = values.length
  return `AND (
    CASE WHEN profile.scope = 'system' THEN 0 ELSE 1 END > $${rank}
    OR (CASE WHEN profile.scope = 'system' THEN 0 ELSE 1 END = $${rank}
      AND profile.created_at < $${createdAt}::timestamptz)
    OR (CASE WHEN profile.scope = 'system' THEN 0 ELSE 1 END = $${rank}
      AND profile.created_at = $${createdAt}::timestamptz AND profile.id < $${id})
  )`
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const limit = parseCatalogLimit(req.nextUrl.searchParams.get('limit'))
  const rawCursor = req.nextUrl.searchParams.get('cursor')
  const cursor = decodeCatalogCursor(rawCursor)
  if (rawCursor && !cursor) return NextResponse.json({ error: '分页游标无效' }, { status: 400 })

  const values: unknown[] = [auth.user.id]
  const cursorClause = cursorSql(cursor, values)
  values.push(limit + 1)
  const result = await query<ProfileRow>(
    `SELECT profile.id, profile.owner_id, profile.scope, profile.name, profile.summary,
            profile.content, profile.is_default, profile.created_at, profile.updated_at
       FROM profiles AS profile
      WHERE (profile.scope = 'system' OR profile.owner_id = $1)
        ${cursorClause}
      ORDER BY CASE WHEN profile.scope = 'system' THEN 0 ELSE 1 END,
               profile.created_at DESC, profile.id DESC
      LIMIT $${values.length}`,
    values,
  )
  const count = await query<{ private_count: number; system_count: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE owner_id = $1 AND scope = 'private')::int AS private_count,
       COUNT(*) FILTER (WHERE scope = 'system')::int AS system_count
       FROM profiles`,
    [auth.user.id],
  )
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit)
  const last = rows.at(-1)
  const nextCursor = hasMore && last
    ? encodeCatalogCursor({ rank: last.scope === 'system' ? 0 : 1, createdAt: iso(last.created_at), id: last.id })
    : null
  return NextResponse.json({
    ok: true,
    items: rows.map(summary),
    pageInfo: { hasMore, nextCursor },
    quota: {
      private: { used: Number(count.rows[0]?.private_count || 0), limit: PRIVATE_PROFILE_LIMIT },
      system: { used: Number(count.rows[0]?.system_count || 0), limit: SYSTEM_PROFILE_LIMIT },
    },
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Profile 格式无效', details: parsed.error.flatten() }, { status: 400 })
  }
  const value = parsed.data
  if (value.scope === 'system' && auth.user.accountType !== 'owner') {
    return NextResponse.json({ error: '只有主账户可以维护系统 Profile' }, { status: 403 })
  }
  const id = randomUUID()
  try {
    await withTransaction(async (client) => {
      await assertCatalogQuota(client, 'profile', value.scope, auth.user.id)
      if (value.isDefault) {
        await client.query('UPDATE profiles SET is_default = false, updated_at = now() WHERE owner_id = $1 AND scope = $2', [auth.user.id, value.scope])
      }
      await client.query(
        `INSERT INTO profiles
          (id, scope, owner_id, name, summary, content, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, value.scope, auth.user.id, value.name, value.summary, value.content, value.isDefault],
      )
    })
    const result = await query<ProfileRow>(
      `SELECT id, owner_id, scope, name, summary, content, is_default, created_at, updated_at
         FROM profiles WHERE id = $1 LIMIT 1`,
      [id],
    )
    const row = result.rows[0]
    if (!row) throw new Error('Profile was not created')
    return NextResponse.json({ ok: true, profile: detail(row) }, { status: 201 })
  } catch (error) {
    const quota = catalogQuotaResponse(error)
    if (quota) return NextResponse.json({ error: quota.error, code: quota.code }, { status: quota.status })
    console.error('[profiles/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '创建 Profile 失败' }, { status: 500 })
  }
}
