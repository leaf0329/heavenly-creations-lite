import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg
const root = process.cwd()

function loadLocalEnv() {
  const file = path.join(root, '.env.local')
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match || process.env[match[1]]) continue
    let value = match[2]?.trim() || ''
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function requireDatabaseUrl() {
  loadLocalEnv()
  const value = process.env.DATABASE_URL?.trim()
  if (!value) throw new Error('DATABASE_URL is not configured')
  return value
}

function migrationChecksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex')
}

const migrationsDir = path.join(root, 'db', 'migrations')
const client = new Client({
  connectionString: requireDatabaseUrl(),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})
const lockKey = 'hc-lite-migrations'

await client.connect()
try {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey])
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT
    )
  `)

  const appliedRows = await client.query('SELECT version, checksum FROM schema_migrations')
  const applied = new Map(appliedRows.rows.map((row) => [row.version, row.checksum]))
  const files = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    const checksum = migrationChecksum(sql)
    if (applied.has(file)) {
      const stored = applied.get(file)
      if (stored && stored !== checksum) {
        throw new Error(`Migration checksum mismatch for ${file}`)
      }
      // Keep an upgrade path for a database initialized before checksums were
      // recorded, without changing any migration's applied SQL.
      if (!stored) {
        await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [file, checksum])
      }
      continue
    }

    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)',
        [file, checksum],
      )
      await client.query('COMMIT')
      console.log(`[migrate] applied ${file}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  console.log('[migrate] PostgreSQL schema is up to date')
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey])
  } catch {
    // Keep the original migration error, if any.
  }
  await client.end()
}

