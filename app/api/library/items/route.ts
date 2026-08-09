import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  createLibraryItem,
  decodeCatalogCursor,
  isLibraryCategory,
  listLibrarySummaries,
  parseCatalogLimit,
  type LibraryCategory,
  type LibraryVisibility,
} from '@/lib/catalog'

export const dynamic = 'force-dynamic'

const librarySchema = z.object({
  visibility: z.enum(['team', 'private']).optional().default('team'),
  category: z.enum(['copy', 'script', 'topic']),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(500).optional().default(''),
  content: z.string().trim().min(1).max(200_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).strict()

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const params = req.nextUrl.searchParams
  const limit = parseCatalogLimit(params.get('limit'))
  const rawCursor = params.get('cursor')
  const cursor = decodeCatalogCursor(rawCursor)
  if (rawCursor && !cursor) return NextResponse.json({ error: '分页游标无效' }, { status: 400 })
  const rawCategory = params.get('category')
  if (rawCategory && !isLibraryCategory(rawCategory)) {
    return NextResponse.json({ error: '信息库分类无效' }, { status: 400 })
  }
  const page = await listLibrarySummaries({
    userId: auth.user.id,
    limit,
    cursor,
    category: rawCategory as LibraryCategory | null,
  })
  return NextResponse.json({ ok: true, items: page.items, pageInfo: { hasMore: page.hasMore, nextCursor: page.nextCursor } })
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
  const parsed = librarySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '信息库条目格式无效', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const item = await createLibraryItem(randomUUID(), auth.user.id, {
      visibility: parsed.data.visibility as LibraryVisibility,
      category: parsed.data.category,
      title: parsed.data.title,
      summary: parsed.data.summary,
      content: parsed.data.content,
      tags: parsed.data.tags,
      metadata: parsed.data.metadata,
    })
    return NextResponse.json({ ok: true, item, id: item.id }, { status: 201 })
  } catch (error) {
    console.error('[library/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '保存信息库条目失败' }, { status: 500 })
  }
}
