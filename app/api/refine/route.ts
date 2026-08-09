import { NextRequest } from 'next/server'
import { handleRefineRequest } from './shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handleRefineRequest(req)
}

