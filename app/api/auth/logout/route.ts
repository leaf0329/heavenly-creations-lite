import { NextRequest, NextResponse } from 'next/server'
import {
  clearSessionCookie,
  getSessionTokenFromRequest,
  revokeSession,
} from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    await revokeSession(getSessionTokenFromRequest(request))
  } catch (error) {
    console.error('[auth] logout revoke failed', error instanceof Error ? error.message : error)
  }
  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response)
  return response
}

