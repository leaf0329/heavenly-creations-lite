import { NextRequest } from 'next/server'
import { handleRefineRequest } from '../shared'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: '原任务不存在' }, { status: 404 })
  return handleRefineRequest(req, id)
}
