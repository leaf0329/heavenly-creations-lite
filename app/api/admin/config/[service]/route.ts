import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth'
import { getServiceConfig, isServiceName, upsertServiceConfig } from '@/lib/service-config'

export const dynamic = 'force-dynamic'

const configSchema = z.object({
  provider: z.string().max(100).optional(),
  endpoint: z.string().max(2_000).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(20_000).nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
}).strict()

type Params = { params: Promise<{ service: string }> }

async function serviceFromParams(params: Params['params']): Promise<string> {
  const value = await params
  return value.service
}

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const service = await serviceFromParams(context.params)
  if (!isServiceName(service)) return NextResponse.json({ error: '不支持的服务配置' }, { status: 404 })
  const config = await getServiceConfig(service)
  if (!config) return NextResponse.json({ error: '服务配置不存在', service }, { status: 404 })
  return NextResponse.json({ ok: true, config })
}

export async function PUT(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const service = await serviceFromParams(context.params)
  if (!isServiceName(service)) return NextResponse.json({ error: '不支持的服务配置' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = configSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '配置格式无效', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const config = await upsertServiceConfig({ service, ...parsed.data }, auth.user.id)
    return NextResponse.json({ ok: true, config })
  } catch (error) {
    // Do not include the error object: it could contain a provider response or
    // an accidentally supplied secret. The configuration itself is never
    // echoed except through the masked representation above.
    console.error('[admin/config] update failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '保存服务配置失败' }, { status: 500 })
  }
}
