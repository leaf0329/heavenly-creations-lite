import 'server-only'

import crypto from 'node:crypto'
import { getEnv, getSessionSecret } from './env'
import { query } from './db'

export type AuthRateLimitDimension = 'ip' | 'account'

export interface AuthRateLimitResult {
  attempts: number
  blocked: boolean
  retryAfter: number
}

function hashKey(value: string): string {
  // The database only receives a keyed digest. A high-entropy session secret
  // prevents a database reader from recovering raw IPs or account names.
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex')
}

function retryAfterSeconds(value: unknown): number {
  if (!value) return 0
  const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
}

export function getLoginRateLimitConfig() {
  const env = getEnv()
  return {
    windowMs: env.authLoginWindowMs,
    maxAttempts: env.authLoginMaxAttempts,
    blockMs: env.authLoginBlockMs,
  }
}

export async function isAuthRateLimited(
  dimension: AuthRateLimitDimension,
  rawKey: string,
): Promise<{ blocked: boolean; retryAfter: number }> {
  const result = await query<{ blocked_until: Date | string | null }>(
    `SELECT blocked_until
       FROM auth_rate_limits
      WHERE dimension = $1 AND key_hash = $2`,
    [dimension, hashKey(rawKey)],
  )
  const retryAfter = retryAfterSeconds(result.rows[0]?.blocked_until)
  return { blocked: retryAfter > 0, retryAfter }
}

export async function recordAuthFailure(input: {
  dimension: AuthRateLimitDimension
  key: string
  windowMs?: number
  maxAttempts?: number
  blockMs?: number
}): Promise<AuthRateLimitResult> {
  const config = getLoginRateLimitConfig()
  const windowMs = input.windowMs ?? config.windowMs
  const maxAttempts = input.maxAttempts ?? config.maxAttempts
  const blockMs = input.blockMs ?? config.blockMs
  const result = await query<{ attempts: number; blocked_until: Date | string | null }>(
    `INSERT INTO auth_rate_limits
      (dimension, key_hash, window_started_at, attempts, blocked_until, updated_at)
     VALUES (
       $1, $2, now(), 1,
       CASE WHEN $4::integer <= 1
         THEN now() + ($5::bigint * interval '1 millisecond')
         ELSE NULL
       END,
       now()
     )
     ON CONFLICT (dimension, key_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN now() - auth_rate_limits.window_started_at >= ($3::bigint * interval '1 millisecond')
           THEN now()
         ELSE auth_rate_limits.window_started_at
       END,
       attempts = CASE
         WHEN now() - auth_rate_limits.window_started_at >= ($3::bigint * interval '1 millisecond')
           THEN 1
         ELSE auth_rate_limits.attempts + 1
       END,
       blocked_until = CASE
         WHEN auth_rate_limits.blocked_until > now() THEN auth_rate_limits.blocked_until
         WHEN (
           CASE
             WHEN now() - auth_rate_limits.window_started_at >= ($3::bigint * interval '1 millisecond')
               THEN 1
             ELSE auth_rate_limits.attempts + 1
           END
         ) >= $4::integer
           THEN now() + ($5::bigint * interval '1 millisecond')
         ELSE NULL
       END,
       updated_at = now()
     RETURNING attempts, blocked_until`,
    [input.dimension, hashKey(input.key), windowMs, maxAttempts, blockMs],
  )
  const row = result.rows[0]
  const retryAfter = retryAfterSeconds(row?.blocked_until)
  return {
    attempts: Number(row?.attempts || 0),
    blocked: retryAfter > 0,
    retryAfter,
  }
}

export async function clearAuthFailures(
  dimension: AuthRateLimitDimension,
  rawKey: string,
): Promise<void> {
  await query(
    'DELETE FROM auth_rate_limits WHERE dimension = $1 AND key_hash = $2',
    [dimension, hashKey(rawKey)],
  )
}

