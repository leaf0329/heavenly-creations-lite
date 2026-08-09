import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  deleteAgentConversation,
  getAgentAssetSelectionStatus,
  getAgentConversationForUser,
  listAgentMessages,
  updateAgentConversationTitle,
} from '@/lib/agent'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const updateSchema = z.object({ title: z.string().trim().max(200) }).strict()
const idSchema = z.string().uuid()

async function conversationId(params: Params['params']): Promise<string> {
  const value = await params
  return value.id
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await conversationId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  try {
    const conversation = await getAgentConversationForUser(id, auth.user.id)
    if (!conversation) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    const messages = await listAgentMessages(id, auth.user.id)
    const assetSelection = await getAgentAssetSelectionStatus(id, auth.user.id)
    return NextResponse.json({ ok: true, conversation: { ...conversation, messages, assetSelection } })
  } catch (error) {
    console.error('[agent/conversation/detail] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '读取对话失败' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '对话参数无效', details: parsed.error.flatten() }, { status: 400 })
  const id = await conversationId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  try {
    const conversation = await updateAgentConversationTitle(id, auth.user.id, parsed.data.title)
    if (!conversation) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, conversation })
  } catch (error) {
    console.error('[agent/conversation/update] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '更新对话失败' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await conversationId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  try {
    const deleted = await deleteAgentConversation(id, auth.user.id)
    if (!deleted) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, deleted: true })
  } catch (error) {
    console.error('[agent/conversation/delete] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '删除对话失败' }, { status: 500 })
  }
}
