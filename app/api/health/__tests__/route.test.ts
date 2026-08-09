import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pingDatabase: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  pingDatabase: mocks.pingDatabase,
  query: mocks.query,
}))

import { GET as getLive } from '@/app/api/health/live/route'
import { GET as getReady } from '@/app/api/health/ready/route'

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pingDatabase.mockResolvedValue(true)
    mocks.query.mockResolvedValue({ rows: [
      { table_name: 'schema_migrations' },
      { table_name: 'users' },
      { table_name: 'auth_sessions' },
    ] })
  })

  it('returns an uncached liveness payload without touching the database', async () => {
    const response = getLive()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ ok: true, uptime: expect.any(Number) })
    expect(mocks.pingDatabase).not.toHaveBeenCalled()
  })

  it('requires both a reachable database and the minimal schema', async () => {
    const response = await getReady()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })

    mocks.query.mockResolvedValueOnce({ rows: [{ table_name: 'users' }] })
    const notReady = await getReady()
    expect(notReady.status).toBe(503)
    await expect(notReady.json()).resolves.toEqual({ ok: false })
  })
})

