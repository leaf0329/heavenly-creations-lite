import 'server-only'

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { getEnv } from './env'

type DbExecutor = Pick<Pool | PoolClient, 'query'>

const state = globalThis as typeof globalThis & {
  __hc_lite_pg_pool?: Pool
  __hc_lite_pg_ready?: Promise<void>
}

export function getPool(): Pool {
  if (!state.__hc_lite_pg_pool) {
    const env = getEnv()
    const configuredMax = Number(process.env.PG_POOL_MAX || 10)
    const max = Number.isFinite(configuredMax)
      ? Math.max(1, Math.min(Math.floor(configuredMax), 50))
      : 10

    state.__hc_lite_pg_pool = new Pool({
      connectionString: env.databaseUrl,
      max,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: process.env.NODE_ENV === 'test',
      ssl: env.pgSsl ? { rejectUnauthorized: true } : undefined,
    })
    state.__hc_lite_pg_pool.on('error', (error) => {
      // Do not include connection strings or credentials in this message.
      console.error('[db] PostgreSQL idle client error', error instanceof Error ? error.message : error)
    })
  }
  return state.__hc_lite_pg_pool
}

export async function initDatabase(): Promise<void> {
  if (!state.__hc_lite_pg_ready) {
    state.__hc_lite_pg_ready = getPool().query('SELECT 1').then(() => undefined)
  }
  return state.__hc_lite_pg_ready
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  executor: DbExecutor = getPool(),
): Promise<QueryResult<T>> {
  return executor.query<T>(text, values)
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original error. The connection is released below.
    }
    throw error
  } finally {
    client.release()
  }
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function closeDb(): Promise<void> {
  if (!state.__hc_lite_pg_pool) return
  await state.__hc_lite_pg_pool.end()
  state.__hc_lite_pg_pool = undefined
  state.__hc_lite_pg_ready = undefined
}

