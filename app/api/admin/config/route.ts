import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { listServiceConfigs } from '@/lib/service-config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req)
  if (!auth.ok) return auth.response
  const configs = await listServiceConfigs()
  return NextResponse.json({ ok: true, configs, services: configs })
}
