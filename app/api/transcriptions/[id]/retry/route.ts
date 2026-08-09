import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { getJobForUser, retryJobForUser } from '@/lib/jobs'
import { enqueueJob } from '@/lib/job-queue'
import { toPublicSttJob } from '@/lib/stt'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid()

export async function POST(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = (await context.params).id
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  const existing = await getJobForUser(id, auth.user.id)
  if (!existing || existing.type !== 'stt') return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  if (existing.sourceKind === 'upload') {
    return NextResponse.json({
      error: '本地上传文件已清理，请重新上传视频',
      code: 'reupload_required',
    }, { status: 409 })
  }
  const retried = await retryJobForUser(id, auth.user.id)
  if (!retried) return NextResponse.json({ error: '任务当前不可重试' }, { status: 409 })
  enqueueJob()
  return NextResponse.json({ ok: true, job: toPublicSttJob(retried) }, { status: 202 })
}
