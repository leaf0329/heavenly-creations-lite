import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getUserByUsername: vi.fn(),
  setSessionCookie: vi.fn(),
  toPublicUser: vi.fn(),
  updateLastLogin: vi.fn(),
  verifyPassword: vi.fn(),
  clearAuthFailures: vi.fn(),
  getLoginRateLimitConfig: vi.fn(),
  isAuthRateLimited: vi.fn(),
  recordAuthFailure: vi.fn(),
  revokeSession: vi.fn(),
  clearSessionCookie: vi.fn(),
  getSessionTokenFromRequest: vi.fn(),
  getUserFromRequest: vi.fn(),
  trustProxy: true,
}))

vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  getUserByUsername: mocks.getUserByUsername,
  setSessionCookie: mocks.setSessionCookie,
  toPublicUser: mocks.toPublicUser,
  updateLastLogin: mocks.updateLastLogin,
  verifyPassword: mocks.verifyPassword,
  revokeSession: mocks.revokeSession,
  clearSessionCookie: mocks.clearSessionCookie,
  getSessionTokenFromRequest: mocks.getSessionTokenFromRequest,
  getUserFromRequest: mocks.getUserFromRequest,
  normalizeUsername: (value: string) => value.trim().toLowerCase(),
}))
vi.mock('@/lib/auth-rate-limit', () => ({
  clearAuthFailures: mocks.clearAuthFailures,
  getLoginRateLimitConfig: mocks.getLoginRateLimitConfig,
  isAuthRateLimited: mocks.isAuthRateLimited,
  recordAuthFailure: mocks.recordAuthFailure,
}))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ trustProxy: mocks.trustProxy }),
}))

import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'

const user = {
  id: 'user-id',
  username: 'owner',
  displayName: 'Owner',
  passwordHash: 'hash',
  accountType: 'owner' as const,
  status: 'active' as const,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  passwordChangedAt: new Date(),
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trustProxy = true
    mocks.isAuthRateLimited.mockResolvedValue({ blocked: false, retryAfter: 0 })
    mocks.getLoginRateLimitConfig.mockReturnValue({ windowMs: 60_000, maxAttempts: 3, blockMs: 60_000 })
    mocks.recordAuthFailure.mockResolvedValue({ attempts: 1, blocked: false, retryAfter: 0 })
    mocks.getUserByUsername.mockResolvedValue(user)
    mocks.verifyPassword.mockResolvedValue(true)
    mocks.createSession.mockResolvedValue({ token: 'session-token', sessionId: 'session-id', expiresAt: new Date() })
    mocks.toPublicUser.mockReturnValue({ id: 'user-id', username: 'owner', accountType: 'owner' })
    mocks.updateLastLogin.mockResolvedValue(undefined)
    mocks.clearAuthFailures.mockResolvedValue(undefined)
    mocks.revokeSession.mockResolvedValue(undefined)
    mocks.clearSessionCookie.mockImplementation(() => undefined)
    mocks.getSessionTokenFromRequest.mockReturnValue('session-token')
  })

  it('logs in and establishes a server-side session cookie', async () => {
    const response = await login(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: ' Owner ', password: 'secret' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: { id: 'user-id', username: 'owner', accountType: 'owner' } })
    expect(mocks.createSession).toHaveBeenCalledWith('user-id', expect.objectContaining({ ip: '127.0.0.1' }))
    expect(mocks.setSessionCookie).toHaveBeenCalled()
  })

  it('returns a generic failure and records both rate-limit dimensions', async () => {
    mocks.verifyPassword.mockResolvedValue(false)
    const response = await login(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'wrong' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '用户名或密码错误' })
    expect(mocks.recordAuthFailure).toHaveBeenCalledTimes(2)
  })

  it('ignores forwarded client headers unless the trusted proxy mode is enabled', async () => {
    mocks.trustProxy = false
    const response = await login(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'secret' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    }))
    expect(response.status).toBe(200)
    expect(mocks.createSession).toHaveBeenCalledWith('user-id', expect.objectContaining({ ip: 'direct-client' }))
  })

  it('rejects oversized login bodies before parsing JSON', async () => {
    const response = await login(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'secret' }),
      headers: { 'content-type': 'application/json', 'content-length': '9000' },
    }))
    expect(response.status).toBe(413)
    expect(mocks.getUserByUsername).not.toHaveBeenCalled()
  })

  it('revokes the current session and clears the cookie on logout', async () => {
    const response = await logout(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.revokeSession).toHaveBeenCalledWith('session-token')
    expect(mocks.clearSessionCookie).toHaveBeenCalled()
  })
})
