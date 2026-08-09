import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import {
  AGENT_ASSET_SELECTION_NOTICE,
  AgentAssetSelectionError,
  AgentNotFoundError,
  confirmAgentAssetSelection,
  getAgentAssetSelectionStatus,
} from '@/lib/agent'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid()

async function getId(params: Params['params']): Promise<string> {
  const value = await params
  return value.id
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await getId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  try {
    const selection = await getAgentAssetSelectionStatus(id, auth.user.id)
    return NextResponse.json({ ok: true, assetSelection: selection, selection, notice: selection.confirmed ? AGENT_ASSET_SELECTION_NOTICE : undefined })
  } catch (error) {
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    console.error('[agent/assets/get] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '读取资产选择失败' }, { status: 500 })
  }
}

async function confirm(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await getId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  try {
    const selection = await confirmAgentAssetSelection(id, auth.user.id, body)
    return NextResponse.json({ ok: true, assetSelection: selection, selection, notice: AGENT_ASSET_SELECTION_NOTICE })
  } catch (error) {
    if (error instanceof AgentAssetSelectionError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, missing: error.missing }, { status: 400 })
    }
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
    console.error('[agent/assets/confirm] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '确认资产选择失败' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, context: Params) {
  return confirm(req, context)
}

export async function POST(req: NextRequest, context: Params) {
  return confirm(req, context)
}
