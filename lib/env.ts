import 'server-only'

/**
 * Environment access is kept in one place so route handlers and database
 * helpers fail with a useful message instead of silently using a development
 * fallback for a security-sensitive value.
 */
export interface AppEnv {
  databaseUrl: string
  sessionSecret: string
  configEncryptionKey: string | undefined
  appOrigin: string | undefined
  cookieSecure: boolean
  trustProxy: boolean
  pgSsl: boolean
  authLoginWindowMs: number
  authLoginMaxAttempts: number
  authLoginBlockMs: number
  sessionTtlSeconds: number
}

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim()
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} must be configured${minimumLength > 1 ? ` with at least ${minimumLength} characters` : ''}`)
  }
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function booleanValue(name: string, fallback: boolean): boolean {
  const value = optional(name)?.toLowerCase()
  if (!value) return fallback
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  throw new Error(`${name} must be true or false`)
}

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const raw = optional(name)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

export function getEnv(): AppEnv {
  return {
    databaseUrl: required('DATABASE_URL'),
    sessionSecret: required('SESSION_SECRET', 32),
    configEncryptionKey: optional('CONFIG_ENCRYPTION_KEY'),
    appOrigin: optional('APP_ORIGIN'),
    cookieSecure: booleanValue('COOKIE_SECURE', process.env.NODE_ENV === 'production'),
    trustProxy: booleanValue('TRUST_PROXY', false),
    pgSsl: booleanValue('PG_SSL', false),
    authLoginWindowMs: positiveInteger('AUTH_LOGIN_WINDOW_MS', 15 * 60 * 1000),
    authLoginMaxAttempts: positiveInteger('AUTH_LOGIN_MAX_ATTEMPTS', 8),
    authLoginBlockMs: positiveInteger('AUTH_LOGIN_BLOCK_MS', 15 * 60 * 1000),
    sessionTtlSeconds: positiveInteger('SESSION_TTL_SECONDS', 7 * 24 * 60 * 60),
  }
}

export function getDatabaseUrl(): string {
  return required('DATABASE_URL')
}

export function getSessionSecret(): string {
  return required('SESSION_SECRET', 32)
}

export function isCookieSecure(): boolean {
  return booleanValue('COOKIE_SECURE', process.env.NODE_ENV === 'production')
}
