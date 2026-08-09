import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/**
 * Resolve the key used for service API secrets.
 *
 * HCLite's example environment uses base64, while accepting a 64-character
 * hex value makes local migration from the original project straightforward.
 * In either form the decoded key must be exactly 32 bytes; there is no weak
 * development fallback.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.CONFIG_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new Error('CONFIG_ENCRYPTION_KEY must be configured for API key storage')
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  // Accept regular and URL-safe base64. Padding is optional for base64url.
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  let decoded: Buffer
  try {
    decoded = Buffer.from(padded, 'base64')
  } catch {
    throw new Error('CONFIG_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex value')
  }
  if (decoded.length !== 32) {
    throw new Error('CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return decoded
}

export function validateEncryptionConfig(): boolean {
  getEncryptionKey()
  return true
}

/**
 * Encrypt a service API key with AES-256-GCM.
 *
 * The persisted representation is `iv:ciphertext:authTag` in hex. A fresh
 * random IV is generated for every value, and the authentication tag ensures
 * tampering is rejected during decryption.
 */
export function encrypt(text: string): string {
  if (typeof text !== 'string') throw new TypeError('Secret must be a string')
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`
}

/** Decrypt a value produced by {@link encrypt}; authentication failures throw. */
export function decrypt(data: string): string {
  if (!isEncrypted(data)) throw new Error('Invalid encrypted secret format')
  const [ivHex, encryptedHex, authTagHex] = data.split(':') as [string, string, string]
  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Return whether a value has the expected AES-GCM persisted shape. */
export function isEncrypted(data: string): boolean {
  if (typeof data !== 'string') return false
  const parts = data.split(':')
  if (parts.length !== 3) return false
  const [ivHex, ciphertextHex, tagHex] = parts
  return /^[0-9a-f]{24}$/i.test(ivHex || '')
    && /^[0-9a-f]*$/i.test(ciphertextHex || '')
    && (ciphertextHex?.length || 0) % 2 === 0
    && /^[0-9a-f]{32}$/i.test(tagHex || '')
}

// Explicit aliases make call sites self-documenting while retaining the
// concise names used by the existing server helpers.
export const encryptSecret = encrypt
export const decryptSecret = decrypt
export const isEncryptedSecret = isEncrypted

export { AUTH_TAG_LENGTH }
