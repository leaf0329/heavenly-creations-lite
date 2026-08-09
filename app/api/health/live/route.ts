import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'cache-control': 'no-store' },
  })
}

