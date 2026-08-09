import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { searchAgentLibrary, searchAgentWeb } from '@/lib/agent'

export const dynamic = 'force-dynamic'

const searchSchema = z.object({
  source: z.enum(['library', 'web']).default('library'),
  query: z.string().trim().min(1).max(500),
  conversationId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict()

async function run(req: NextRequest, body: unknown) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const parsed = searchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '检索参数无效', details: parsed.error.flatten() }, { status: 400 })
  try {
    if (parsed.data.source === 'library') {
      const results = await searchAgentLibrary(auth.user.id, parsed.data.query, parsed.data.limit)
      return NextResponse.json({ ok: true, source: 'library', results })
    }
    const result = await searchAgentWeb({
      query: parsed.data.query,
      userId: auth.user.id,
      conversationId: parsed.data.conversationId,
    })
    return NextResponse.json({ ok: true, source: 'web', ...result })
  } catch (error) {
    console.error('[agent/search] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '检索失败' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  return run(req, {
    source: params.get('source') || 'library',
    query: params.get('query') || '',
    conversationId: params.get('conversationId') || undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  return run(req, body)
}

