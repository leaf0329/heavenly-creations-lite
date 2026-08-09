import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, toPublicUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
    return NextResponse.json({ user: toPublicUser(user) })
  } catch (error) {
    console.error('[auth] session lookup failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: '登录服务暂时不可用' }, { status: 500 })
  }
}

