import crypto from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const oldUrl = process.env.OLD_DATABASE_URL?.trim()
const newUrl = process.env.DATABASE_URL?.trim()
const oldKeyRaw = process.env.OLD_STORE_ENCRYPTION_KEY?.trim()
const newKeyRaw = process.env.CONFIG_ENCRYPTION_KEY?.trim()
if (!oldUrl || !newUrl || !oldKeyRaw || !newKeyRaw) throw new Error('Migration environment is incomplete')

function key(raw, name) {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decoded.length !== 32) throw new Error(`${name} must decode to 32 bytes`)
  return decoded
}

function decrypt(value, encryptionKey) {
  const [iv, ciphertext, tag] = String(value).split(':')
  if (!iv || !ciphertext || !tag) throw new Error('Source API key has invalid encrypted format')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8')
}

function encrypt(value, encryptionKey) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${cipher.getAuthTag().toString('hex')}`
}

const mapping = new Map([['text', 'text'], ['agent', 'agent'], ['audio', 'audio'], ['watermark', 'video_parser']])
const oldEncryptionKey = key(oldKeyRaw, 'OLD_STORE_ENCRYPTION_KEY')
const newEncryptionKey = key(newKeyRaw, 'CONFIG_ENCRYPTION_KEY')
const oldClient = new Client({ connectionString: oldUrl })
const newClient = new Client({ connectionString: newUrl })
await oldClient.connect()
await newClient.connect()
try {
  const source = await oldClient.query(
    `SELECT id, provider, api_key, endpoint, model, options, enabled
       FROM configs WHERE id = ANY($1::text[]) ORDER BY id`,
    [[...mapping.keys()]],
  )
  if (source.rowCount !== mapping.size) throw new Error('Not all company service configs exist')
  const owner = await newClient.query("SELECT id FROM users WHERE account_type = 'owner' LIMIT 1")
  if (!owner.rows[0]?.id) throw new Error('HCLite owner account is missing')
  await newClient.query('BEGIN')
  for (const row of source.rows) {
    if (!mapping.has(row.id) || !row.provider || !row.endpoint || typeof row.api_key !== 'string') {
      throw new Error(`Source configuration is incomplete for ${row.id || 'unknown'}`)
    }
    const apiKey = decrypt(row.api_key, oldEncryptionKey)
    if (!apiKey) throw new Error(`Source key is empty for ${row.id}`)
    const service = mapping.get(row.id)
    await newClient.query(
      `INSERT INTO service_configs
        (service, provider, endpoint, model, encrypted_api_key, options, enabled, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (service) DO UPDATE SET provider=EXCLUDED.provider, endpoint=EXCLUDED.endpoint,
         model=EXCLUDED.model, encrypted_api_key=EXCLUDED.encrypted_api_key,
         options=EXCLUDED.options, enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [service, row.provider, row.endpoint, row.model || '', encrypt(apiKey, newEncryptionKey), JSON.stringify(row.options || {}), row.enabled !== false, owner.rows[0].id],
    )
  }
  const verification = await newClient.query(
    `SELECT service, encrypted_api_key FROM service_configs WHERE service = ANY($1::text[])`,
    [[...mapping.values()]],
  )
  if (verification.rowCount !== mapping.size) throw new Error('Destination configuration count is incomplete')
  for (const row of verification.rows) {
    if (!decrypt(row.encrypted_api_key, newEncryptionKey)) throw new Error(`Destination key verification failed for ${row.service}`)
  }
  await newClient.query('COMMIT')
  console.log(`[config] Migrated ${mapping.size} company service configurations without printing secrets`)
} catch (error) {
  await newClient.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await Promise.all([oldClient.end(), newClient.end()])
}
