import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { getServiceConfig, getStoredServiceConfig, isServiceName } from '@/lib/service-config'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ service: string }> }

export async function POST(req: NextRequest, context: Params) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const params = await context.params
  if (!isServiceName(params.service)) return NextResponse.json({ error: '不支持的服务配置' }, { status: 400 })

  try {
    const config = await getServiceConfig(params.service)
    if (!config) {
      return NextResponse.json({ ok: false, configured: false, error: '尚未保存配置' }, { status: 200 })
    }
    // This intentionally does not send a request to a third-party provider.
    // The endpoint test is a safe configuration/readiness check; actual AI
    // calls validate provider credentials in their own task paths.
    const stored = await getStoredServiceConfig(params.service)
    const endpointValid = !config.endpoint || /^https?:\/\//i.test(config.endpoint)
    const providerValid = params.service !== 'video_parser' || config.provider.trim().toLowerCase() === 'tikhub'
    const configured = config.enabled && Boolean(config.model || config.provider) && Boolean(stored?.apiKey) && providerValid
    return NextResponse.json({
      ok: configured && endpointValid,
      configured,
      endpointValid,
      providerValid,
      checkType: 'local-validation',
      providerRequestSent: false,
      service: params.service,
    })
  } catch (error) {
    console.error('[admin/config] test failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ ok: false, configured: false, error: '配置校验失败' }, { status: 200 })
  }
}
