import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE_NAME = 'hc_session'

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE_NAME)?.value) {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
    const location = `/login?${new URLSearchParams({ next }).toString()}`

    // Keep the redirect relative so reverse-proxy deployments never expose the
    // application's internal host or port (for example, localhost:3001).
    return new NextResponse(null, {
      status: 307,
      headers: { location },
    })
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|login|_next/static|_next/image|favicon.ico).*)',
  ],
}
