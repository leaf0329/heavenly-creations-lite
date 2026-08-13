import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createUploadObjectKey, createUploadUrl } from '@/lib/oss-storage'
import { STT_MAX_UPLOAD_BYTES } from '@/lib/stt'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive().max(STT_MAX_UPLOAD_BYTES),
}).strict()

function supported(filename: string, mimeType: string): boolean {
  if (mimeType.toLowerCase().startsWith('video/')) return true
  return /\.(mp4|mov|m4v|webm|mkv|avi|flv|ts|mts|m2ts)$/i.test(filename)
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '请选择有效且不超过上传上限的视频' }, { status: 400 })
  if (!supported(parsed.data.filename, parsed.data.mimeType)) {
    return NextResponse.json({ error: '暂不支持该视频格式' }, { status: 415 })
  }
  try {
    const objectKey = createUploadObjectKey(auth.user.id, parsed.data.filename)
    const url = await createUploadUrl(objectKey, parsed.data.mimeType)
    return NextResponse.json({
      ok: true,
      upload: {
        method: 'PUT',
        url,
        objectKey,
        expiresIn: 600,
        headers: { 'Content-Type': parsed.data.mimeType },
      },
    })
  } catch (error) {
    console.error('[transcriptions/upload-url] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '暂时无法创建上传地址' }, { status: 503 })
  }
}
