import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { enqueueJob } from '@/lib/job-queue'
import { jobSummary, retryJobForUser } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '任务不存在、尚未失败或已超过安全重试次数' }, { status: 409 })
  const job = await retryJobForUser(id, auth.user.id)
  if (!job) return NextResponse.json({ error: '任务不存在、尚未失败或已超过安全重试次数' }, { status: 409 })
  enqueueJob()
  return NextResponse.json({ ok: true, jobId: job.id, job: jobSummary(job), replayed: false }, { status: 202 })
}
