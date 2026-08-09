import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  AGENT_ALLOWED_CAPABILITIES,
  AGENT_ASSET_SELECTION_NOTICE,
  AgentAssetSelectionError,
  AgentNotFoundError,
  isAgentIntent,
  processAgentMessage,
  prohibitedAgentCapability,
  type AgentIntent,
} from '@/lib/agent'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const messageSchema = z.object({
  content: z.string().trim().min(1).max(20_000).optional(),
  message: z.string().trim().min(1).max(20_000).optional(),
  taskType: z.unknown().optional(),
  intent: z.string().optional(),
  action: z.string().optional(),
  assetSelection: z.unknown().optional(),
  confirmAssets: z.boolean().optional(),
  confirmAssetSelection: z.boolean().optional(),
  searchQuery: z.string().trim().max(500).optional(),
}).strict()
const idSchema = z.string().uuid()

async function getId(params: Params['params']): Promise<string> {
  const value = await params
  return value.id
}

function normalizeIntent(value: string | undefined): AgentIntent | string | undefined {
  if (!value) return undefined
  if (value === 'transcribe' || value === 'transcription') return 'transcription-entry'
  if (value === 'library' || value === 'search-library') return 'library-search'
  if (value === 'search-web') return 'web-search'
  return isAgentIntent(value) ? value : value
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await getId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  const parsedLimit = Number(req.nextUrl.searchParams.get('limit') || 200)
  const limit = Number.isSafeInteger(parsedLimit) ? parsedLimit : 200
  try {
    const { getAgentConversationForUser, listAgentMessages } = await import('@/lib/agent')
    const conversation = await getAgentConversationForUser(id, auth.user.id)
    if (!conversation) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    const messages = await listAgentMessages(id, auth.user.id, limit)
    return NextResponse.json({ ok: true, messages, items: messages })
  } catch (error) {
    console.error('[agent/messages/list] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '读取消息失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const conversationId = await getId(context.params)
  if (!idSchema.safeParse(conversationId).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = messageSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '消息参数无效', details: parsed.error.flatten() }, { status: 400 })
  const content = parsed.data.content || parsed.data.message || ''
  const rawIntent = parsed.data.intent || parsed.data.action
  const intent = normalizeIntent(rawIntent)
  const capability = prohibitedAgentCapability(typeof parsed.data.taskType === 'string' ? parsed.data.taskType : rawIntent)
  if (capability) {
    return NextResponse.json({
      ok: false,
      error: 'Agent 不支持该能力',
      code: 'UNSUPPORTED_AGENT_CAPABILITY',
      capability,
      allowedCapabilities: AGENT_ALLOWED_CAPABILITIES,
    }, { status: 400 })
  }
  try {
    const result = await processAgentMessage({
      conversationId,
      userId: auth.user.id,
      content,
      taskType: parsed.data.taskType,
      intent,
      assetSelection: parsed.data.assetSelection,
      confirmAssets: parsed.data.confirmAssets || parsed.data.confirmAssetSelection,
      searchQuery: parsed.data.searchQuery,
    })
    if (result.kind === 'requires-asset-selection') {
      return NextResponse.json({
        ok: false,
        requiresAssetSelection: true,
        reason: 'no_confirmed_assets_or_defaults',
        assetSelection: result.selection,
        selection: result.selection.available,
        notice: AGENT_ASSET_SELECTION_NOTICE,
      }, { status: 409 })
    }
    if (result.kind === 'transcription-entry') {
      return NextResponse.json({ ok: true, intent: 'transcription-entry', entry: { href: result.href } })
    }
    if (result.kind === 'library-search') {
      return NextResponse.json({ ok: true, intent: 'library-search', results: result.results })
    }
    if (result.kind === 'web-search') {
      return NextResponse.json({ ok: true, intent: 'web-search', ...result.result })
    }
    return NextResponse.json({
      ok: true,
      message: result.message,
      job: result.job,
      jobId: result.job.id,
      taskType: result.taskType,
      assetSelection: result.selection,
      notice: result.selection.confirmed ? AGENT_ASSET_SELECTION_NOTICE : undefined,
    }, { status: 202 })
  } catch (error) {
    if (error instanceof AgentAssetSelectionError) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        code: error.code,
        missing: error.missing,
      }, { status: 400 })
    }
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('Agent 不支持')) {
      return NextResponse.json({
        ok: false,
        error: message,
        code: 'UNSUPPORTED_AGENT_CAPABILITY',
        allowedCapabilities: AGENT_ALLOWED_CAPABILITIES,
      }, { status: 400 })
    }
    console.error('[agent/messages/create] failed', message || 'unknown error')
    return NextResponse.json({ error: '发送 Agent 消息失败' }, { status: 500 })
  }
}
