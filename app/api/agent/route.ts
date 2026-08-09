import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  AGENT_ALLOWED_CAPABILITIES,
  AGENT_ASSET_SELECTION_NOTICE,
  AgentAssetSelectionError,
  AgentNotFoundError,
  createAgentConversation,
  listAgentConversations,
  processAgentMessage,
  prohibitedAgentCapability,
} from '@/lib/agent'

export const dynamic = 'force-dynamic'

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  message: z.string().trim().min(1).max(20_000).optional(),
  title: z.string().trim().max(200).optional(),
  taskType: z.unknown().optional(),
  intent: z.string().optional(),
  action: z.string().optional(),
  assetSelection: z.unknown().optional(),
  confirmAssets: z.boolean().optional(),
  confirmAssetSelection: z.boolean().optional(),
  searchQuery: z.string().trim().max(500).optional(),
}).strict()

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  try {
    const conversations = await listAgentConversations(auth.user.id, Number(req.nextUrl.searchParams.get('limit') || 50))
    return NextResponse.json({ ok: true, conversations, items: conversations })
  } catch (error) {
    console.error('[agent/list] failed', error instanceof Error ? error.message : 'unknown error')
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
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Agent 参数无效', details: parsed.error.flatten() }, { status: 400 })
  const content = parsed.data.content || parsed.data.message || ''
  const intent = parsed.data.intent || parsed.data.action
  const capability = prohibitedAgentCapability(typeof parsed.data.taskType === 'string' ? parsed.data.taskType : intent)
  if (capability) {
    return NextResponse.json({ ok: false, error: 'Agent 不支持该能力', code: 'UNSUPPORTED_AGENT_CAPABILITY', capability, allowedCapabilities: AGENT_ALLOWED_CAPABILITIES }, { status: 400 })
  }
  try {
    const conversation = parsed.data.conversationId
      ? await import('@/lib/agent').then(({ getAgentConversationForUser }) => getAgentConversationForUser(parsed.data.conversationId!, auth.user.id))
      : await createAgentConversation(auth.user.id, parsed.data.title || content.slice(0, 200))
    if (!conversation) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    const result = await processAgentMessage({
      conversationId: conversation.id,
      userId: auth.user.id,
      content,
      taskType: parsed.data.taskType,
      intent,
      assetSelection: parsed.data.assetSelection,
      confirmAssets: parsed.data.confirmAssets || parsed.data.confirmAssetSelection,
      searchQuery: parsed.data.searchQuery,
    })
    if (result.kind === 'requires-asset-selection') return NextResponse.json({ ok: false, requiresAssetSelection: true, reason: 'no_confirmed_assets_or_defaults', assetSelection: result.selection, selection: result.selection.available, notice: AGENT_ASSET_SELECTION_NOTICE }, { status: 409 })
    if (result.kind === 'transcription-entry') return NextResponse.json({ ok: true, conversation, intent: 'transcription-entry', entry: { href: result.href } })
    if (result.kind === 'library-search') return NextResponse.json({ ok: true, conversation, intent: 'library-search', results: result.results })
    if (result.kind === 'web-search') return NextResponse.json({ ok: true, conversation, intent: 'web-search', ...result.result })
    return NextResponse.json({ ok: true, conversation, message: result.message, job: result.job, jobId: result.job.id, taskType: result.taskType, assetSelection: result.selection, notice: result.selection.confirmed ? AGENT_ASSET_SELECTION_NOTICE : undefined }, { status: 202 })
  } catch (error) {
    if (error instanceof AgentAssetSelectionError) return NextResponse.json({ ok: false, error: error.message, code: error.code, missing: error.missing }, { status: 400 })
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('Agent 不支持')) return NextResponse.json({ ok: false, error: message, code: 'UNSUPPORTED_AGENT_CAPABILITY', allowedCapabilities: AGENT_ALLOWED_CAPABILITIES }, { status: 400 })
    console.error('[agent/send] failed', message || 'unknown error')
    return NextResponse.json({ error: '发送 Agent 消息失败' }, { status: 500 })
  }
}

