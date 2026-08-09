import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { listJobsForUser, type JobStatus } from '@/lib/jobs'
import { toPublicSttJob } from '@/lib/stt'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const params = req.nextUrl.searchParams
  const rawStatus = params.get('status')
  const statuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed']
  if (rawStatus && !statuses.includes(rawStatus as JobStatus)) {
    return NextResponse.json({ error: '任务状态无效' }, { status: 400 })
  }
  const rawLimit = Number(params.get('limit') || 50)
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50
  try {
    const jobs = await listJobsForUser(auth.user.id, {
      type: 'stt',
      status: rawStatus as JobStatus | null,
      search: params.get('search'),
      limit,
    })
    return NextResponse.json({ ok: true, jobs: jobs.map(toPublicSttJob) })
  } catch (error) {
    console.error('[transcriptions] list failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '获取转写任务失败' }, { status: 500 })
  }
}
