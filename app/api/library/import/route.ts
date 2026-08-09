import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createLibraryItems } from '@/lib/catalog'

export const dynamic = 'force-dynamic'

const importItemSchema = z.object({
  visibility: z.enum(['team', 'private']).optional().default('team'),
  category: z.enum(['copy', 'script', 'topic']),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(500).optional().default(''),
  content: z.string().trim().min(1).max(200_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).strict()

const importSchema = z.object({ items: z.array(importItemSchema).min(1).max(100) }).strict()

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = importSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '导入数据格式无效', details: parsed.error.flatten() }, { status: 400 })
  try {
    const items = await createLibraryItems(parsed.data.items.map((value) => ({
      id: randomUUID(),
      creatorId: auth.user.id,
      input: value,
    })))
    return NextResponse.json({ ok: true, items, count: items.length }, { status: 201 })
  } catch (error) {
    console.error('[library/import] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '导入信息库失败' }, { status: 500 })
  }
}
