import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const username = process.env.MEMBER_USERNAME?.trim().toLowerCase()
const password = process.env.MEMBER_PASSWORD || ''
const displayName = (process.env.MEMBER_DISPLAY_NAME || username || '').trim().slice(0, 100)
if (!databaseUrl) throw new Error('DATABASE_URL is not configured')
if (!username || !/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) throw new Error('MEMBER_USERNAME is invalid')
if (password.length < 12 || password.length > 200) throw new Error('MEMBER_PASSWORD must contain 12-200 characters')

const client = new Client({ connectionString: databaseUrl, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined })
await client.connect()
try {
  await client.query('BEGIN')
  const owner = await client.query("SELECT id FROM users WHERE account_type = 'owner' LIMIT 1")
  if (!owner.rows[0]?.id) throw new Error('Owner account must be initialized first')
  const existing = await client.query('SELECT id FROM users WHERE lower(username) = $1 LIMIT 1', [username])
  if (existing.rowCount) {
    console.log('[member] Account already exists; credentials were not changed')
  } else {
    await client.query(
      `INSERT INTO users (id, username, display_name, password_hash, account_type, status, created_by)
       VALUES ($1,$2,$3,$4,'member','active',$5)`,
      [crypto.randomUUID(), username, displayName, await bcrypt.hash(password, 12), owner.rows[0].id],
    )
    console.log(`[member] Created member account ${username}`)
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
