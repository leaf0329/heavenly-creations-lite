import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import bcrypt from 'bcryptjs'
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

function requiredDatabaseUrl() {
  loadLocalEnv()
  const value = process.env.DATABASE_URL?.trim()
  if (!value) throw new Error('DATABASE_URL is not configured')
  return value
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined
}

function normalizeUsername(value) {
  return value.trim().toLowerCase()
}

function validateUsername(value) {
  const normalized = normalizeUsername(value)
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(normalized)) {
    throw new Error('Owner username must be 3-50 characters: letters, numbers, dot, underscore, or hyphen')
  }
  return normalized
}

function validatePassword(value) {
  if (value.length < 12) throw new Error('Owner password must contain at least 12 characters')
  if (value.length > 200) throw new Error('Owner password is too long')
  return value
}

async function collectInput() {
  const fromEnvironment = {
    username: process.env.OWNER_USERNAME || cliValue('username'),
    password: process.env.OWNER_PASSWORD || cliValue('password'),
    displayName: process.env.OWNER_DISPLAY_NAME || cliValue('display-name'),
  }
  if (fromEnvironment.username && fromEnvironment.password) return fromEnvironment

  if (!input.isTTY || !output.isTTY) {
    throw new Error('Set OWNER_USERNAME and OWNER_PASSWORD for non-interactive initialization')
  }

  const rl = readline.createInterface({ input, output })
  try {
    const username = fromEnvironment.username || await rl.question('Owner username: ')
    const password = fromEnvironment.password || await rl.question('Owner password: ')
    const displayName = fromEnvironment.displayName || await rl.question('Display name (optional): ')
    return { username, password, displayName }
  } finally {
    rl.close()
  }
}

const values = await collectInput()
const username = validateUsername(values.username || '')
const password = validatePassword(values.password || '')
const displayName = (values.displayName || username).trim().slice(0, 100)
const passwordHash = await bcrypt.hash(password, 12)
const client = new Client({
  connectionString: requiredDatabaseUrl(),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})

await client.connect()
try {
  await client.query('BEGIN')
  const existing = await client.query("SELECT id FROM users WHERE account_type = 'owner' LIMIT 1")
  if (existing.rowCount) {
    await client.query('ROLLBACK')
    console.log('[owner] An owner account already exists; no changes made')
  } else {
    await client.query(
      `INSERT INTO users
        (id, username, display_name, password_hash, account_type, status)
       VALUES ($1, $2, $3, $4, 'owner', 'active')`,
      [crypto.randomUUID(), username, displayName, passwordHash],
    )
    await client.query('COMMIT')
    console.log(`[owner] Created owner account ${username}`)
  }
} catch (error) {
  try { await client.query('ROLLBACK') } catch {}
  if (error?.code === '23505') {
    throw new Error('An owner or username already exists; no changes made')
  }
  throw error
} finally {
  await client.end()
}
