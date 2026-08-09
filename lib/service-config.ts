import 'server-only'

import { decrypt, encrypt, isEncrypted } from './crypto'
import { query } from './db'

export const SERVICE_NAMES = ['text', 'agent', 'audio', 'video_parser'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceOptions {
  [key: string]: unknown
}

export interface ServiceConfigPublic {
  service: ServiceName
  provider: string
  endpoint: string
  model: string
  options: ServiceOptions
  enabled: boolean
  hasKey: boolean
  updatedAt: string | null
}

export interface StoredServiceConfig extends ServiceConfigPublic {
  apiKey: string | null
}

interface ServiceConfigRow {
  service: ServiceName
  provider: string
  endpoint: string
  model: string
  encrypted_api_key: string | null
  options: ServiceOptions | string | null
  enabled: boolean
  updated_at: Date | string | null
}

export interface UpdateServiceConfigInput {
  service: ServiceName
  provider?: string
  endpoint?: string
  model?: string
  /** undefined retains the current key, null or an empty string clears it. */
  apiKey?: string | null
  options?: ServiceOptions
  enabled?: boolean
}

export function isServiceName(value: unknown): value is ServiceName {
  return typeof value === 'string' && (SERVICE_NAMES as readonly string[]).includes(value)
}

function isoDate(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeOptions(value: ServiceConfigRow['options']): ServiceOptions {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as ServiceOptions
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function publicConfig(row: ServiceConfigRow): ServiceConfigPublic {
  return {
    service: row.service,
    provider: row.provider,
    endpoint: row.endpoint,
    model: row.model,
    options: normalizeOptions(row.options),
    enabled: row.enabled,
    hasKey: Boolean(row.encrypted_api_key),
    updatedAt: isoDate(row.updated_at),
  }
}

function storedConfig(row: ServiceConfigRow): StoredServiceConfig {
  const result = publicConfig(row)
  let apiKey: string | null = null
  if (row.encrypted_api_key) {
    // Never silently fall back to plaintext. A legacy/malformed value should
    // fail loudly instead of exposing a key through a new code path.
    if (!isEncrypted(row.encrypted_api_key)) throw new Error(`Invalid encrypted key for ${row.service}`)
    apiKey = decrypt(row.encrypted_api_key)
  }
  return { ...result, apiKey }
}

const SELECT_COLUMNS = `
  service,
  provider,
  endpoint,
  model,
  encrypted_api_key,
  options,
  enabled,
  updated_at
`

export async function listServiceConfigs(): Promise<ServiceConfigPublic[]> {
  const result = await query<ServiceConfigRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM service_configs
      ORDER BY CASE service
        WHEN 'text' THEN 0
        WHEN 'agent' THEN 1
        WHEN 'audio' THEN 2
        WHEN 'video_parser' THEN 3
        ELSE 4 END`,
  )
  const configured = new Map(result.rows.map((row) => [row.service, publicConfig(row)]))
  // Returning all four slots keeps the admin page deterministic even before
  // the first save, while still leaving the database free of placeholder
  // records that would need an owner foreign key.
  return SERVICE_NAMES.map((service) => configured.get(service) || {
    service,
    provider: '',
    endpoint: '',
    model: '',
    options: {},
    enabled: false,
    hasKey: false,
    updatedAt: null,
  })
}

export async function getServiceConfig(service: ServiceName): Promise<ServiceConfigPublic | null> {
  const result = await query<ServiceConfigRow>(
    `SELECT ${SELECT_COLUMNS} FROM service_configs WHERE service = $1 LIMIT 1`,
    [service],
  )
  const row = result.rows[0]
  return row ? publicConfig(row) : null
}

export async function getStoredServiceConfig(service: ServiceName): Promise<StoredServiceConfig | null> {
  const result = await query<ServiceConfigRow>(
    `SELECT ${SELECT_COLUMNS} FROM service_configs WHERE service = $1 LIMIT 1`,
    [service],
  )
  const row = result.rows[0]
  return row ? storedConfig(row) : null
}

/**
 * Upsert one shared service configuration. API keys are encrypted before the
 * query and are never returned by this function. An omitted apiKey retains a
 * previous key; null/empty explicitly removes it.
 */
export async function upsertServiceConfig(
  input: UpdateServiceConfigInput,
  updatedBy: string,
): Promise<ServiceConfigPublic> {
  if (!isServiceName(input.service)) throw new Error('Unsupported service')
  const hasApiKeyField = Object.prototype.hasOwnProperty.call(input, 'apiKey')
  const apiKey = input.apiKey && input.apiKey.trim() ? encrypt(input.apiKey) : null
  const options = input.options === undefined ? null : JSON.stringify(input.options)
  const result = await query<ServiceConfigRow>(
    `INSERT INTO service_configs
      (service, provider, endpoint, model, encrypted_api_key, options, enabled, updated_by)
     VALUES ($1, COALESCE($2, ''), COALESCE($3, ''), COALESCE($4, ''), $5,
             COALESCE($6::jsonb, '{}'::jsonb), COALESCE($7, true), $8)
     ON CONFLICT (service) DO UPDATE SET
       provider = COALESCE($2, service_configs.provider),
       endpoint = COALESCE($3, service_configs.endpoint),
       model = COALESCE($4, service_configs.model),
       encrypted_api_key = CASE WHEN $9 THEN $5 ELSE service_configs.encrypted_api_key END,
       options = COALESCE($6::jsonb, service_configs.options),
       enabled = COALESCE($7, service_configs.enabled),
       updated_by = $8,
       updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.service,
      input.provider === undefined ? null : input.provider.trim(),
      input.endpoint === undefined ? null : input.endpoint.trim(),
      input.model === undefined ? null : input.model.trim(),
      hasApiKeyField ? apiKey : null,
      options,
      input.enabled === undefined ? null : input.enabled,
      updatedBy,
      hasApiKeyField,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Service configuration was not saved')
  return publicConfig(row)
}
