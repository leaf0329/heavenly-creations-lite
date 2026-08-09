import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createJob } from '@/lib/jobs'
import { enqueueJob } from '@/lib/job-queue'
import { MultipartBodyError, readSingleFileMultipart } from '@/lib/multipart-body'
import { STT_MAX_TOTAL_BYTES, STT_MAX_UPLOAD_BYTES, removeSttTemporaryPath, toPublicSttJob } from '@/lib/stt'

export const dynamic = 'force-dynamic'

const fieldSchema = z.object({
  title: z.string().trim().max(200).optional(),
}).passthrough()

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let filePath: string | null = null
  try {
    const parsed = await readSingleFileMultipart(req, {
      fileField: 'file',
      maxFileBytes: STT_MAX_UPLOAD_BYTES,
      maxTotalBytes: STT_MAX_TOTAL_BYTES,
      maxFields: 4,
      maxFieldBytes: 8 * 1024,
      tempDir: path.join(process.cwd(), 'data', 'stt-temp'),
    })
    filePath = parsed.file.filePath
    const fieldsResult = fieldSchema.safeParse(parsed.fields)
    if (!fieldsResult.success) throw new MultipartBodyError('表单字段无效', 400)
    const title = fieldsResult.data.title || parsed.file.filename
    const job = await createJob({
      userId: auth.user.id,
      type: 'stt',
      title,
      input: { sourceFilename: parsed.file.filename, mimeType: parsed.file.mimeType },
      sourceKind: 'upload',
      sourceFilename: parsed.file.filename,
      temporaryPath: parsed.file.filePath,
      sourceMetadata: { mimeType: parsed.file.mimeType, bytes: parsed.file.size },
    })
    filePath = null
    enqueueJob()
    return NextResponse.json({ ok: true, job: toPublicSttJob(job) }, { status: 202 })
  } catch (error) {
    if (filePath) await removeSttTemporaryPath(filePath)
    if (error instanceof MultipartBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[transcriptions/upload] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '上传转写任务创建失败' }, { status: 500 })
  }
}
