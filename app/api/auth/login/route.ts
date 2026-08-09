import { NextRequest, NextResponse } from 'next/server'
import {
  createSession,
  getUserByUsername,
  normalizeUsername,
  setSessionCookie,
  toPublicUser,
  updateLastLogin,
  verifyPassword,
} from '@/lib/auth'
import {
  clearAuthFailures,
  getLoginRateLimitConfig,
  isAuthRateLimited,
  recordAuthFailure,
} from '@/lib/auth-rate-limit'
import { getEnv } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientAddress(request: NextRequest): string {
  if (!getEnv().trustProxy) return 'direct-client'
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function retryResponse(retryAfter: number): NextResponse {
  const response = NextResponse.json(
    { error: '登录尝试过于频繁，请稍后再试' },
    { status: 429 },
  )
  response.headers.set('Retry-After', String(Math.max(1, retryAfter)))
  return response
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type')?.toLowerCase() || ''
    if (!contentType.startsWith('application/json')) {
      return NextResponse.json({ error: '请求格式必须是 JSON' }, { status: 415 })
    }
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
      return NextResponse.json({ error: '登录请求过大' }, { status: 413 })
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const rawUsername = typeof body?.username === 'string'
      ? body.username
      : typeof body?.account === 'string' ? body.account : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const username = normalizeUsername(rawUsername)
    if (!username || username.length > 50 || !password || password.length > 200) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 })
    }

    const ip = clientAddress(request)
    const [ipStatus, accountStatus] = await Promise.all([
      isAuthRateLimited('ip', ip),
      isAuthRateLimited('account', username),
    ])
    const retryAfter = Math.max(ipStatus.retryAfter, accountStatus.retryAfter)
    if (retryAfter > 0) return retryResponse(retryAfter)

    const user = await getUserByUsername(username)
    const valid = Boolean(user && user.status === 'active' && await verifyPassword(password, user.passwordHash))
    if (!valid || !user) {
      const config = getLoginRateLimitConfig()
      const [ipFailure, accountFailure] = await Promise.all([
        recordAuthFailure({ dimension: 'ip', key: ip, ...config }),
        recordAuthFailure({ dimension: 'account', key: username, ...config }),
      ])
      const failureRetry = Math.max(ipFailure.retryAfter, accountFailure.retryAfter)
      if (failureRetry > 0) return retryResponse(failureRetry)
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
    }

    await Promise.all([
      clearAuthFailures('ip', ip),
      clearAuthFailures('account', username),
    ])
    const session = await createSession(user.id, {
      ip,
      userAgent: request.headers.get('user-agent'),
    })
    // Last-login telemetry is not part of authentication correctness.
    void updateLastLogin(user.id).catch(() => undefined)

    const response = NextResponse.json({ user: toPublicUser(user) })
    setSessionCookie(response, session.token)
    return response
  } catch (error) {
    console.error('[auth] login failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: '登录服务暂时不可用' }, { status: 500 })
  }
}
