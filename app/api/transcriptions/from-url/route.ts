import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { createJob } from '@/lib/jobs'
import { enqueueJob } from '@/lib/job-queue'
import { toPublicSttJob } from '@/lib/stt'
import { detectPlatform } from '@/lib/video-parser'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  url: z.string().trim().url().max(4_000),
  title: z.string().trim().max(200).optional(),
}).strict()

function canonicalUrl(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('请输入有效的视频分享链接') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('视频分享链接必须使用公开 http/https 地址')
  }
  const platform = detectPlatform(parsed.toString())
  if (platform === 'unknown') throw new Error('暂不支持该视频平台链接')
  return parsed.toString()
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '视频链接格式无效' }, { status: 400 })
  try {
    const url = canonicalUrl(parsed.data.url)
    const platform = detectPlatform(url)
    const job = await createJob({
      userId: auth.user.id,
      type: 'stt',
      title: parsed.data.title || `视频转写 · ${platform}`,
      input: { sourceUrl: url },
      sourceKind: 'url',
      sourceUrl: url,
      sourceMetadata: { platform },
    })
    enqueueJob()
    return NextResponse.json({ ok: true, job: toPublicSttJob(job) }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && /视频|链接|URL|平台/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[transcriptions/from-url] failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: '链接转写任务创建失败' }, { status: 500 })
  }
}
