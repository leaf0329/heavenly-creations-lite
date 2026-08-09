import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import {
  AGENT_ALLOWED_CAPABILITIES,
  AGENT_FORBIDDEN_CAPABILITIES,
  AGENT_INTENTS,
  AGENT_TASK_TYPES,
} from '@/lib/agent'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  return NextResponse.json({
    ok: true,
    taskTypes: AGENT_TASK_TYPES,
    intents: AGENT_INTENTS,
    allowedCapabilities: AGENT_ALLOWED_CAPABILITIES,
    forbiddenCapabilities: AGENT_FORBIDDEN_CAPABILITIES,
  })
}

