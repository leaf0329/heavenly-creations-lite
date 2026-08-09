import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  summary: z.string().max(500).optional(),
  content: z.string().trim().min(1).max(100_000).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
}).strict()
const idSchema = z.string().uuid()

type Params = { params: Promise<{ id: string }> }
type SkillRow = {
  id: string
  owner_id: string
  scope: 'system' | 'private'
  name: string
  summary: string
  content: string
  category: string
  enabled: boolean
  created_at: Date | string
  updated_at: Date | string
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function toResponse(row: SkillRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    scope: row.scope,
    name: row.name,
    summary: row.summary,
    content: row.content,
    category: row.category,
    enabled: row.enabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

async function findSkill(id: string, userId: string): Promise<SkillRow | null> {
  const result = await query<SkillRow>(
    `SELECT id, owner_id, scope, name, summary, content, category, enabled, created_at, updated_at
       FROM skills
      WHERE id = $1 AND (scope = 'system' OR owner_id = $2)
      LIMIT 1`,
    [id, userId],
  )
  return result.rows[0] || null
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  const row = await findSkill(id, auth.user.id)
  if (!row) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, skill: toResponse(row) })
}

export async function PATCH(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  const existing = await findSkill(id, auth.user.id)
  if (!existing) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  if ((existing.scope === 'system' && auth.user.accountType !== 'owner')
    || (existing.scope === 'private' && existing.owner_id !== auth.user.id)) {
    return NextResponse.json({ error: '无权修改此 Skill' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Skill 格式无效', details: parsed.error.flatten() }, { status: 400 })
  const updates = parsed.data
  const fields: string[] = []
  const values: unknown[] = [id]
  const add = (column: string, value: unknown) => {
    values.push(value)
    fields.push(`${column} = $${values.length}`)
  }
  if (updates.name !== undefined) add('name', updates.name)
  if (updates.summary !== undefined) add('summary', updates.summary)
  if (updates.content !== undefined) add('content', updates.content)
  if (updates.category !== undefined) add('category', updates.category)
  if (updates.enabled !== undefined) add('enabled', updates.enabled)
  if (!fields.length) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })

  try {
    const result = await query<SkillRow>(
      `UPDATE skills SET ${fields.join(', ')}, updated_at = now()
        WHERE id = $1
        RETURNING id, owner_id, scope, name, summary, content, category, enabled, created_at, updated_at`,
      values,
    )
    const row = result.rows[0]
    if (!row) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, skill: toResponse(row) })
  } catch (error) {
    console.error('[skills/update] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '更新 Skill 失败' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  const existing = await findSkill(id, auth.user.id)
  if (!existing) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  if ((existing.scope === 'system' && auth.user.accountType !== 'owner')
    || (existing.scope === 'private' && existing.owner_id !== auth.user.id)) {
    return NextResponse.json({ error: '无权删除此 Skill' }, { status: 403 })
  }
  const result = await query('DELETE FROM skills WHERE id = $1', [id])
  if (!(result.rowCount || 0)) return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
