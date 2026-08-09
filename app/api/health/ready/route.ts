import { NextResponse } from 'next/server'
import { pingDatabase, query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const READINESS_TIMEOUT_MS = 2_500

async function checkSchema(): Promise<boolean> {
  const result = await query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [['schema_migrations', 'users', 'auth_sessions']],
  )
  const tables = new Set(result.rows.map((row) => row.table_name))
  return tables.size === 3
}

async function checkReadiness(): Promise<boolean> {
  const database = await pingDatabase()
  if (!database) return false
  return checkSchema()
}

export async function GET() {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const check = checkReadiness()
    const timed = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS)
    })
    const ok = await Promise.race([check, timed])
    return NextResponse.json({ ok }, {
      status: ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('[health] readiness check failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

