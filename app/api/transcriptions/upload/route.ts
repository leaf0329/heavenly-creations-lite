import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createJob } from '@/lib/jobs'
import { enqueueJob } from '@/lib/job-queue'
import { deleteObject, isOwnedUploadObjectKey, statObject } from '@/lib/oss-storage'
import { STT_MAX_UPLOAD_BYTES, toPublicSttJob } from '@/lib/stt'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  objectKey: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive().max(STT_MAX_UPLOAD_BYTES),
  title: z.string().trim().max(200).optional(),
}).strict()

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '上传信息无效' }, { status: 400 })
  const data = parsed.data
  if (!isOwnedUploadObjectKey(data.objectKey, auth.user.id)) {
    return NextResponse.json({ error: '上传文件不属于当前用户' }, { status: 403 })
  }
  try {
    const object = await statObject(data.objectKey)
    if (object.size !== data.size || object.size <= 0 || object.size > STT_MAX_UPLOAD_BYTES) {
      await deleteObject(data.objectKey).catch(() => undefined)
      return NextResponse.json({ error: '上传文件大小校验失败，请重新上传' }, { status: 400 })
    }
    const job = await createJob({
      userId: auth.user.id,
      type: 'stt',
      title: data.title || data.filename,
      input: { sourceFilename: data.filename, mimeType: data.mimeType },
      sourceKind: 'upload',
      sourceFilename: data.filename,
      sourceMetadata: {
        mimeType: object.contentType || data.mimeType,
        bytes: object.size,
        storage: 'oss',
        ossObjectKey: data.objectKey,
      },
    })
    enqueueJob()
    return NextResponse.json({ ok: true, job: toPublicSttJob(job) }, { status: 202 })
  } catch (error) {
    console.error('[transcriptions/upload] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '上传转写任务创建失败' }, { status: 500 })
  }
}
