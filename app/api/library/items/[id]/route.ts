import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  deleteLibraryItem,
  getLibraryItem,
  isLibraryCategory,
  isLibraryVisibility,
  updateLibraryItem,
  type LibraryCategory,
  type LibraryVisibility,
} from '@/lib/catalog'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  visibility: z.enum(['team', 'private']).optional(),
  category: z.enum(['copy', 'script', 'topic']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(500).optional(),
  content: z.string().trim().min(1).max(200_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()
const idSchema = z.string().uuid()

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '信息库条目不存在' }, { status: 404 })
  const item = await getLibraryItem(id, auth.user.id)
  if (!item) return NextResponse.json({ error: '信息库条目不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, item })
}

export async function PATCH(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '信息库条目不存在' }, { status: 404 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '信息库条目格式无效', details: parsed.error.flatten() }, { status: 400 })
  const value = parsed.data
  if (value.visibility !== undefined && !isLibraryVisibility(value.visibility)) {
    return NextResponse.json({ error: '可见性无效' }, { status: 400 })
  }
  if (value.category !== undefined && !isLibraryCategory(value.category)) {
    return NextResponse.json({ error: '分类无效' }, { status: 400 })
  }
  try {
    const item = await updateLibraryItem(id, auth.user.id, auth.user.accountType === 'owner', {
      visibility: value.visibility as LibraryVisibility | undefined,
      category: value.category as LibraryCategory | undefined,
      title: value.title,
      summary: value.summary,
      content: value.content,
      tags: value.tags,
      metadata: value.metadata,
    })
    if (!item) return NextResponse.json({ error: '信息库条目不存在或无权修改' }, { status: 404 })
    return NextResponse.json({ ok: true, item })
  } catch (error) {
    if (error instanceof Error && error.message === 'No library fields to update') {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }
    console.error('[library/update] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '更新信息库条目失败' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '信息库条目不存在' }, { status: 404 })
  try {
    const deleted = await deleteLibraryItem(id, auth.user.id, auth.user.accountType === 'owner')
    if (!deleted) return NextResponse.json({ error: '信息库条目不存在或无权删除' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[library/delete] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '删除信息库条目失败' }, { status: 500 })
  }
}
