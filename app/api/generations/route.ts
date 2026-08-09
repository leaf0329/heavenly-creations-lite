import { NextRequest } from 'next/server'
import { handleGenerationRequest } from './shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handleGenerationRequest(req)
}

