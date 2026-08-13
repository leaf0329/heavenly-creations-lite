import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'

describe('workspace middleware', () => {
  it('redirects through the configured public origin instead of the internal host', () => {
    const previousOrigin = process.env.APP_ORIGIN
    process.env.APP_ORIGIN = 'https://a.private.meikaai.cn'

    const response = middleware(new NextRequest('http://localhost/agent?mode=topic'))

    if (previousOrigin === undefined) delete process.env.APP_ORIGIN
    else process.env.APP_ORIGIN = previousOrigin

    expect(response.status).toBe(307)
    const rawLocation = response.headers.get('location') || ''
    const location = new URL(rawLocation)
    expect(location.origin).toBe('https://a.private.meikaai.cn')
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
