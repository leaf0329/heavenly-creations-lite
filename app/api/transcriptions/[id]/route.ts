import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { deleteJobForUser, getJobForUser } from '@/lib/jobs'
import { removeSttTemporaryPath, toPublicSttJob } from '@/lib/stt'
import { deleteObject, isOwnedUploadObjectKey } from '@/lib/oss-storage'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function getId(params: Params['params']): Promise<string> {
  return (await params).id
}

const idSchema = z.string().uuid()

export async function GET(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await getId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  const job = await getJobForUser(id, auth.user.id)
  if (!job || job.type !== 'stt') return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, job: toPublicSttJob(job) })
}

export async function DELETE(req: NextRequest, context: Params) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const id = await getId(context.params)
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  const job = await getJobForUser(id, auth.user.id)
  if (!job || job.type !== 'stt') return NextResponse.json({ error: '转写任务不存在' }, { status: 404 })
  if (job.status === 'processing') return NextResponse.json({ error: '任务处理中，暂不能删除' }, { status: 409 })
  const deleted = await deleteJobForUser(id, auth.user.id)
  if (!deleted) return NextResponse.json({ error: '任务状态已改变' }, { status: 409 })
  await removeSttTemporaryPath(job.temporaryPath)
  const objectKey = typeof job.sourceMetadata.ossObjectKey === 'string' ? job.sourceMetadata.ossObjectKey : ''
  if (objectKey && isOwnedUploadObjectKey(objectKey, auth.user.id)) {
    await deleteObject(objectKey).catch(() => undefined)
  }
  return NextResponse.json({ ok: true })
}
