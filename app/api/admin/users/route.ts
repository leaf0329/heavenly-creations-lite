import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hashPassword, normalizeUsername, requireOwner } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const createUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,49}$/),
  displayName: z.string().trim().max(100).optional().default(''),
  password: z.string().min(12).max(200),
}).strict()

type MemberRow = {
  id: string
  username: string
  display_name: string
  status: 'active' | 'disabled'
  created_at: Date | string
  updated_at: Date | string
  last_login_at: Date | string | null
}

function iso(value: Date | string | null) {
  if (!value) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function member(row: MemberRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastLoginAt: iso(row.last_login_at),
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const result = await query<MemberRow>(
    `SELECT id, username, display_name, status, created_at, updated_at, last_login_at
       FROM users WHERE account_type = 'member'
      ORDER BY created_at DESC, id DESC`,
  )
  const members = result.rows.map(member)
  return NextResponse.json({
    ok: true,
    members,
    summary: {
      total: members.length,
      active: members.filter((item) => item.status === 'active').length,
      disabled: members.filter((item) => item.status === 'disabled').length,
    },
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '用户信息格式无效', details: parsed.error.flatten() }, { status: 400 })
  }
  const username = normalizeUsername(parsed.data.username)
  try {
    const passwordHash = await hashPassword(parsed.data.password)
    const result = await query<MemberRow>(
      `INSERT INTO users
        (id, username, display_name, password_hash, account_type, status, created_by)
       VALUES ($1, $2, $3, $4, 'member', 'active', $5)
       RETURNING id, username, display_name, status, created_at, updated_at, last_login_at`,
      [randomUUID(), username, parsed.data.displayName || username, passwordHash, auth.user.id],
    )
    return NextResponse.json({ ok: true, member: member(result.rows[0]!) }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 })
    }
    console.error('[admin/users] create failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '创建用户失败' }, { status: 500 })
  }
}
