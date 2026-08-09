import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { deleteJobForUser, getJobForUser, getQueuePosition, jobDetail } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  const job = await getJobForUser(id, auth.user.id)
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  const position = job.status === 'pending' ? await getQueuePosition(id, auth.user.id) : null
  return NextResponse.json({ ok: true, job: jobDetail(job, position) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  const job = await getJobForUser(id, auth.user.id)
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  if (job.status === 'processing') return NextResponse.json({ error: '任务正在处理，暂不支持删除' }, { status: 409 })
  const deleted = await deleteJobForUser(id, auth.user.id)
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '任务状态已变化' }, { status: 409 })
}
