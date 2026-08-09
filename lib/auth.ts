import 'server-only'

import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getEnv, getSessionSecret, isCookieSecure } from './env'
import { query } from './db'

export const SESSION_COOKIE_NAME = 'hc_session'

export interface UserRecord {
  id: string
  username: string
  displayName: string
  passwordHash: string
  accountType: 'owner' | 'member'
  status: 'active' | 'disabled'
  createdBy: string | null
  createdAt: Date | string
  updatedAt: Date | string
  lastLoginAt: Date | string | null
  passwordChangedAt: Date | string
}

export interface PublicUser {
  id: string
  username: string
  displayName: string
  accountType: 'owner' | 'member'
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string | null
}

export interface SessionMetadata {
  ip?: string | null
  userAgent?: string | null
  ttlSeconds?: number
}

const USER_COLUMNS = `
  users.id::text AS id,
  users.username,
  users.display_name AS "displayName",
  users.password_hash AS "passwordHash",
  users.account_type AS "accountType",
  users.status,
  users.created_by::text AS "createdBy",
  users.created_at AS "createdAt",
  users.updated_at AS "updatedAt",
  users.last_login_at AS "lastLoginAt",
  users.password_changed_at AS "passwordChangedAt"
`

function asIsoDate(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash)
}

// Synchronous helpers are useful only for small administrative scripts and
// preserve a straightforward migration path for callers that cannot await.
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, 12)
}

export function verifyPasswordSync(password: string, passwordHash: string): boolean {
  return bcrypt.compareSync(password, passwordHash)
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id],
  )
  return result.rows[0] || null
}

export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(username) = $1 LIMIT 1`,
    [normalizeUsername(username)],
  )
  return result.rows[0] || null
}

export async function updateLastLogin(userId: string): Promise<void> {
  await query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [userId])
}

function hashClientValue(value: string | null | undefined): string | null {
  if (!value) return null
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex')
}

export async function createSession(
  userId: string,
  metadata: SessionMetadata = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const env = getEnv()
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const sessionId = crypto.randomUUID()
  const ttlSeconds = metadata.ttlSeconds ?? env.sessionTtlSeconds
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60) {
    throw new Error('Session TTL must be at least 60 seconds')
  }
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await query(
    `INSERT INTO auth_sessions
      (id, user_id, token_hash, expires_at, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, tokenHash, expiresAt, hashClientValue(metadata.ip), metadata.userAgent?.slice(0, 500) || null],
  )
  return { token, sessionId, expiresAt }
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token) return
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await query(
    'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1',
    [tokenHash],
  )
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  )
}

function parseCookieHeader(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

export function getSessionTokenFromRequest(req: NextRequest | Request): string | null {
  const nextCookies = 'cookies' in req && typeof req.cookies?.get === 'function'
    ? req.cookies.get(SESSION_COOKIE_NAME)?.value
    : undefined
  return nextCookies || parseCookieHeader(req.headers.get('cookie'), SESSION_COOKIE_NAME)
}

export async function getUserFromRequest(req: NextRequest | Request): Promise<UserRecord | null> {
  const token = getSessionTokenFromRequest(req)
  if (!token) return null
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const result = await query<UserRecord>(
    `SELECT ${USER_COLUMNS}
       FROM auth_sessions AS sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > now()
        AND users.status = 'active'
      LIMIT 1`,
    [tokenHash],
  )
  const user = result.rows[0] || null
  if (user) {
    // Session activity is deliberately best-effort. An unavailable update
    // must not turn an otherwise valid request into a logout.
    void query('UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]).catch(() => undefined)
  }
  return user
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountType: user.accountType,
    status: user.status,
    createdAt: asIsoDate(user.createdAt) || new Date(0).toISOString(),
    lastLoginAt: asIsoDate(user.lastLoginAt),
  }
}

export type AuthResult =
  | { ok: true; user: UserRecord }
  | { ok: false; response: NextResponse }

export async function requireUser(req: NextRequest | Request): Promise<AuthResult> {
  const user = await getUserFromRequest(req)
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: '未登录' }, { status: 401 }) }
  }
  return { ok: true, user }
}

export async function requireOwner(req: NextRequest | Request): Promise<AuthResult> {
  const auth = await requireUser(req)
  if (!auth.ok) return auth
  if (auth.user.accountType !== 'owner') {
    return { ok: false, response: NextResponse.json({ error: '无权访问' }, { status: 403 }) }
  }
  return auth
}

export function setSessionCookie(response: NextResponse, token: string): void {
  const maxAge = getEnv().sessionTtlSeconds
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  })
}
