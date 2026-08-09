import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { enqueueJob } from '@/lib/job-queue'
import { createJob, jobSummary } from '@/lib/jobs'
import { TEXT_JOB_TYPES, type TextJobType } from '@/lib/job-registry'

const generationSchema = z.object({
  type: z.string().optional(),
  title: z.string().trim().max(200).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  skillIds: z.array(z.string().uuid()).max(20).optional(),
  profileIds: z.array(z.string().uuid()).max(20).optional(),
  useLibrary: z.boolean().optional(),
  librarySearch: z.string().max(200).optional(),
}).strict()

function isTextJobType(value: unknown): value is TextJobType {
  return typeof value === 'string' && (TEXT_JOB_TYPES as readonly string[]).includes(value)
}

export async function handleGenerationRequest(req: NextRequest, forcedType?: string): Promise<NextResponse> {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const parsed = generationSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '文案任务格式无效', details: parsed.error.flatten() }, { status: 400 })
  const typeValue = forcedType || parsed.data.type
  if (!isTextJobType(typeValue)) return NextResponse.json({ error: '不支持的文案任务类型' }, { status: 400 })
  if (forcedType && parsed.data.type && parsed.data.type !== forcedType) {
    return NextResponse.json({ error: '路径中的任务类型与请求体不一致' }, { status: 400 })
  }
  const base = parsed.data.input || parsed.data.params || {}
  const input: Record<string, unknown> = { ...base }
  if (parsed.data.values) input.values = parsed.data.values
  if (parsed.data.skillIds) input.skillIds = parsed.data.skillIds
  if (parsed.data.profileIds) input.profileIds = parsed.data.profileIds
  if (parsed.data.useLibrary !== undefined) input.useLibrary = parsed.data.useLibrary
  if (parsed.data.librarySearch !== undefined) input.librarySearch = parsed.data.librarySearch
  try {
    const job = await createJob({
      userId: auth.user.id,
      type: typeValue,
      title: parsed.data.title || typeValue,
      input,
    })
    enqueueJob()
    return NextResponse.json({ ok: true, jobId: job.id, job: jobSummary(job), replayed: false }, { status: 202 })
  } catch (error) {
    console.error('[generations/create] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '任务提交失败' }, { status: 500 })
  }
}

