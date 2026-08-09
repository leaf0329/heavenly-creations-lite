import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createAgentConversation, listAgentConversations } from '@/lib/agent'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  title: z.string().trim().max(200).optional().default(''),
}).strict()

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const parsed = Number(req.nextUrl.searchParams.get('limit') || 50)
  const limit = Number.isSafeInteger(parsed) ? parsed : 50
  try {
    const conversations = await listAgentConversations(auth.user.id, limit)
    // Conversation list is deliberately summary-only; messages are available
    // from the detail endpoint after the same user check.
    return NextResponse.json({ ok: true, conversations, items: conversations })
  } catch (error) {
    console.error('[agent/conversations/list] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '读取对话列表失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '对话参数无效', details: parsed.error.flatten() }, { status: 400 })
  try {
    const conversation = await createAgentConversation(auth.user.id, parsed.data.title)
    return NextResponse.json({ ok: true, conversation }, { status: 201 })
  } catch (error) {
    console.error('[agent/conversations/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '创建对话失败' }, { status: 500 })
  }
}

