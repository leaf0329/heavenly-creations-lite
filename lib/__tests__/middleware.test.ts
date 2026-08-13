import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'

describe('workspace middleware', () => {
  it('redirects a request without a session cookie to login', () => {
    const response = middleware(new NextRequest('http://localhost/agent?mode=topic'))
    expect(response.status).toBe(307)
    const rawLocation = response.headers.get('location') || ''
    const location = new URL(rawLocation, 'https://a.private.meikaai.cn')
    expect(rawLocation.startsWith('/')).toBe(true)
    expect(rawLocation).not.toContain('localhost')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/agent?mode=topic')
  })

  it('allows a request that carries a session cookie to continue', () => {
    const response = middleware(new NextRequest('http://localhost/agent', {
      headers: { cookie: 'hc_session=opaque-token' },
    }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
