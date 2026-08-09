import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { enqueueJob } from '@/lib/job-queue'
import { createJob, createRefineJob, getJobForUser, jobSummary } from '@/lib/jobs'
import { TEXT_JOB_TYPES, type TextJobType } from '@/lib/job-registry'

const refineSchema = z.object({
  jobId: z.string().uuid().optional(),
  sourceJobId: z.string().uuid().optional(),
  previousResult: z.string().trim().min(1).max(200_000).optional(),
  instruction: z.string().trim().min(1).max(10_000),
  jobType: z.enum(TEXT_JOB_TYPES).optional(),
  title: z.string().trim().max(200).optional(),
  skillIds: z.array(z.string().uuid()).max(20).optional(),
  profileIds: z.array(z.string().uuid()).max(20).optional(),
}).strict()

function isTextType(value: unknown): value is TextJobType {
  return typeof value === 'string' && (TEXT_JOB_TYPES as readonly string[]).includes(value)
}

export async function handleRefineRequest(req: NextRequest, forcedJobId?: string): Promise<NextResponse> {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 }) }
  const parsed = refineSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '优化任务格式无效', details: parsed.error.flatten() }, { status: 400 })
  const data = parsed.data
  const sourceId = forcedJobId || data.jobId || data.sourceJobId
  try {
    let job
    if (sourceId) {
      const parent = await getJobForUser(sourceId, auth.user.id)
      if (!parent) return NextResponse.json({ error: '原任务不存在' }, { status: 404 })
      if (parent.status !== 'completed' || !parent.resultText) return NextResponse.json({ error: '只有已完成且有结果的任务可以优化' }, { status: 409 })
      job = await createRefineJob({
        userId: auth.user.id,
        parent,
        instruction: data.instruction,
        title: data.title,
        skillIds: data.skillIds,
        profileIds: data.profileIds,
      })
    } else {
      if (!data.previousResult || !isTextType(data.jobType)) return NextResponse.json({ error: '需要提供原任务 ID' }, { status: 400 })
      job = await createJob({
        userId: auth.user.id,
        type: data.jobType,
        title: data.title || `优化：${data.jobType}`,
        input: {
          previousText: data.previousResult,
          instruction: data.instruction,
          skillIds: data.skillIds || [],
          profileIds: data.profileIds || [],
        },
      })
    }
    enqueueJob()
    return NextResponse.json({ ok: true, jobId: job.id, job: jobSummary(job), replayed: false }, { status: 202 })
  } catch (error) {
    console.error('[refine/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '优化任务提交失败' }, { status: 500 })
  }
}

