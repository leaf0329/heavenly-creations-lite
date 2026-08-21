import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE_NAME = 'hc_session'

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE_NAME)?.value) {
    // Next.js requires an absolute redirect URL. Prefer the configured public
    // origin because request.url can contain the reverse proxy's internal host.
    const login = new URL('/login', process.env.APP_ORIGIN || request.url)
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(login)
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|login|_next/static|_next/image|favicon.ico|brand/|brand-mark.svg|manifest.webmanifest).*)',
  ],
}
