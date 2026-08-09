import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth'
import { query, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '没有可更新的字段')

type Params = { params: Promise<{ id: string }> }
const uuidSchema = z.string().uuid()
type MemberRow = {
  id: string
  username: string
  display_name: string
  status: 'active' | 'disabled'
  created_at: Date | string
  updated_at: Date | string
  last_login_at: Date | string | null
}

function toMember(row: MemberRow) {
  const iso = (value: Date | string | null) => value ? (value instanceof Date ? value : new Date(value)).toISOString() : null
  return { id: row.id, username: row.username, displayName: row.display_name, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lastLoginAt: iso(row.last_login_at) }
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: '成员不存在' }, { status: 404 })
  const result = await query<MemberRow>(
    `SELECT id, username, display_name, status, created_at, updated_at, last_login_at
       FROM users WHERE id = $1 AND account_type = 'member' LIMIT 1`,
    [id],
  )
  const row = result.rows[0]
  return row
    ? NextResponse.json({ ok: true, member: toMember(row) })
    : NextResponse.json({ error: '成员不存在' }, { status: 404 })
}

export async function PATCH(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: '成员不存在' }, { status: 404 })
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '用户信息格式无效', details: parsed.error.flatten() }, { status: 400 })
  const values: unknown[] = [id]
  const fields: string[] = []
  if (parsed.data.displayName !== undefined) { values.push(parsed.data.displayName); fields.push(`display_name = $${values.length}`) }
  if (parsed.data.status !== undefined) { values.push(parsed.data.status); fields.push(`status = $${values.length}`) }
  const result = await withTransaction(async (client) => {
    const updated = await client.query<MemberRow>(
      `UPDATE users SET ${fields.join(', ')}, updated_at = now()
        WHERE id = $1 AND account_type = 'member'
        RETURNING id, username, display_name, status, created_at, updated_at, last_login_at`,
      values,
    )
    if (updated.rows[0] && parsed.data.status === 'disabled') {
      await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    }
    return updated.rows[0]
  })
  return result
    ? NextResponse.json({ ok: true, member: toMember(result) })
    : NextResponse.json({ error: '成员不存在' }, { status: 404 })
}

export async function DELETE(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: '成员不存在' }, { status: 404 })
  const result = await query(`DELETE FROM users WHERE id = $1 AND account_type = 'member'`, [id])
  return result.rowCount
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: '成员不存在' }, { status: 404 })
}
