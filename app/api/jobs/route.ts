import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { enqueueJob } from '@/lib/job-queue'
import { createJob, getQueuePosition, isJobType, jobSummary, listJobsForUser, type JobStatus } from '@/lib/jobs'
import { TEXT_JOB_TYPES, type JobType } from '@/lib/job-registry'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  type: z.enum(TEXT_JOB_TYPES),
  title: z.string().trim().max(200).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()

const statuses = ['pending', 'processing', 'completed', 'failed'] as const

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const params = req.nextUrl.searchParams
  const rawType = params.get('type')
  if (rawType && !isJobType(rawType)) return NextResponse.json({ error: '任务类型无效' }, { status: 400 })
  const rawStatus = params.get('status')
  if (rawStatus && !(statuses as readonly string[]).includes(rawStatus)) return NextResponse.json({ error: '任务状态无效' }, { status: 400 })
  const rawLimit = Number(params.get('limit') || 50)
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50
  const jobs = await listJobsForUser(auth.user.id, {
    type: rawType as JobType | null,
    status: rawStatus as JobStatus | null,
    search: params.get('search'),
    limit,
  })
  const summaries = await Promise.all(jobs.map(async (job) => jobSummary(job, job.status === 'pending' ? await getQueuePosition(job.id, auth.user.id) : null)))
  return NextResponse.json({ ok: true, jobs: summaries, items: summaries })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 }) }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '任务格式无效', details: parsed.error.flatten() }, { status: 400 })
  const data = parsed.data
  try {
    const job = await createJob({
      userId: auth.user.id,
      type: data.type,
      title: data.title || data.type,
      input: data.input || data.params || {},
    })
    enqueueJob()
    return NextResponse.json({ ok: true, jobId: job.id, job: jobSummary(job), replayed: false }, { status: 202 })
  } catch (error) {
    console.error('[jobs/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '任务提交失败' }, { status: 500 })
  }
}
