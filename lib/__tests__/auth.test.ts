import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  hashPassword,
  normalizeUsername,
  toPublicUser,
  verifyPassword,
} from '@/lib/auth'

describe('HCLite authentication primitives', () => {
  it('normalizes account names without exposing credentials', () => {
    expect(normalizeUsername('  Owner.Name ')).toBe('owner.name')
  })

  it('hashes and verifies passwords asynchronously', async () => {
    const hash = await hashPassword('a-secure-password')
    await expect(verifyPassword('a-secure-password', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
    expect(hash).not.toContain('a-secure-password')
  })

  it('maps database users to a safe public shape', () => {
    const user = toPublicUser({
      id: 'owner-id',
      username: 'owner',
      displayName: 'Owner',
      passwordHash: 'private',
      accountType: 'owner',
      status: 'active',
      createdBy: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
      passwordChangedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(user).toEqual({
      id: 'owner-id',
      username: 'owner',
      displayName: 'Owner',
      accountType: 'owner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    })
    expect(user).not.toHaveProperty('passwordHash')
  })
})
