import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hashPassword, requireOwner } from '@/lib/auth'
import { withTransaction } from '@/lib/db'

const schema = z.object({ password: z.string().min(12).max(200) }).strict()
const uuidSchema = z.string().uuid()
type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: '成员不存在' }, { status: 404 })
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '新密码至少需要 12 个字符' }, { status: 400 })
  const passwordHash = await hashPassword(parsed.data.password)
  const changed = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now()
        WHERE id = $1 AND account_type = 'member'`,
      [id, passwordHash],
    )
    if (result.rowCount) {
      await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    }
    return Boolean(result.rowCount)
  })
  return changed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: '成员不存在' }, { status: 404 })
}
