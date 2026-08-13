'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Clipboard, FileText, Link2, Loader2, Mic2, Play, RefreshCw, Trash2, Upload, WandSparkles } from 'lucide-react'
import { PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'

type TranscriptionJob = {
  id: string
  type?: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | string
  title: string
  resultText?: string | null
  sourceKind?: 'upload' | 'url' | 'none' | string
  sourceUrl?: string | null
  sourceFilename?: string | null
  progress?: number
  progressMessage?: string
  errorMessage?: string | null
  attemptCount?: number
  maxAttempts?: number
  createdAt?: string
  completedAt?: string | null
  updatedAt?: string
}

type ApiPayload = {
  ok?: boolean
  job?: TranscriptionJob
  jobs?: TranscriptionJob[]
  items?: TranscriptionJob[]
  error?: string
  code?: string
  upload?: {
    method: 'PUT'
    url: string
    objectKey: string
    headers: Record<string, string>
  }
}

function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'processing') return '处理中'
  return '排队中'
}

function statusTone(status: string): 'neutral' | 'success' | 'working' {
  if (status === 'completed') return 'success'
  if (status === 'pending' || status === 'processing') return 'working'
  return 'neutral'
}

function formatDate(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

async function jsonResponse(response: Response): Promise<ApiPayload> {
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') return {}
  return body as ApiPayload
}

export default function TranscribeClient() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [job, setJob] = useState<TranscriptionJob | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadLatest = useCallback(async () => {
    const response = await fetch('/api/transcriptions?limit=1', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) return
    const payload = await jsonResponse(response)
    const latest = payload.jobs?.[0] || payload.items?.[0]
    if (latest) setJob(latest)
  }, [])

  useEffect(() => { void loadLatest() }, [loadLatest])

  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'processing')) return
    let cancelled = false
    const poll = async () => {
      const response = await fetch(`/api/transcriptions/${encodeURIComponent(job.id)}`, { credentials: 'include', cache: 'no-store' })
      if (!response.ok || cancelled) return
      const payload = await jsonResponse(response)
      if (payload.job) setJob(payload.job)
    }
    const interval = window.setInterval(() => { void poll() }, 2000)
    void poll()
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [job])

  const handleUpload = async () => {
    if (!file || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    setUploadProgress(0)
    try {
      const prepareResponse = await fetch('/api/transcriptions/upload-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }),
      })
      const prepared = await jsonResponse(prepareResponse)
      if (!prepareResponse.ok || !prepared.upload) throw new Error(prepared.error || '暂时无法创建上传地址')
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', prepared.upload!.url)
        for (const [name, value] of Object.entries(prepared.upload!.headers)) xhr.setRequestHeader(name, value)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100))
        }
        xhr.onerror = () => reject(new Error('上传失败，请检查网络后重新上传视频'))
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`视频上传失败 (${xhr.status})`))
        xhr.send(file)
      })
      const completeResponse = await fetch('/api/transcriptions/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: prepared.upload.objectKey,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      })
      const completed = await jsonResponse(completeResponse)
      if (!completeResponse.ok || !completed.job) throw new Error(completed.error || '上传转写任务创建失败')
      setJob(completed.job)
      setNotice('文件已上传，正在排队转写')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传转写任务创建失败')
    } finally {
      setLoading(false)
      setUploadProgress(null)
    }
  }

  const handleUrl = async () => {
    const value = url.trim()
    if (!value || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/transcriptions/from-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      })
      const payload = await jsonResponse(response)
      if (!response.ok || !payload.job) throw new Error(payload.error || '链接转写任务创建失败')
      setJob(payload.job)
      setUrl('')
      setNotice('链接已提交，正在排队转写')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '链接转写任务创建失败')
    } finally { setLoading(false) }
  }

  const handleRetry = async () => {
    if (!job || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/transcriptions/${encodeURIComponent(job.id)}/retry`, { method: 'POST', credentials: 'include' })
      const payload = await jsonResponse(response)
      if (!response.ok || !payload.job) {
        if (response.status === 409 && payload.code === 'reupload_required') {
          setError('本地上传文件已清理，请重新上传视频')
        } else setError(payload.error || '任务当前不可重试')
        return
      }
      setJob(payload.job)
      setNotice('已重新排队，正在转写')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务重试失败') }
    finally { setLoading(false) }
  }

  const handleDelete = async () => {
    if (!job || deleting) return
    setDeleting(true)
    setError('')
    try {
      const response = await fetch(`/api/transcriptions/${encodeURIComponent(job.id)}`, { method: 'DELETE', credentials: 'include' })
      const payload = await jsonResponse(response)
      if (!response.ok) throw new Error(payload.error || '删除任务失败')
      setJob(null)
      setNotice('任务已删除')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除任务失败') }
    finally { setDeleting(false) }
  }

  const copyResult = async () => {
    const value = job?.resultText || ''
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { setError('复制失败，请手动选择文字') }
  }

  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)))

  return (
    <div className="space-y-7 pb-8">
      <PageIntro eyebrow="WORKSPACE / TRANSCRIBE" title="视频转文字" description="上传本地视频或粘贴视频链接，得到一份可以继续编辑的文字稿。" action={<Link href="/history?tab=transcribe" className="section-link">查看转写历史 <ArrowUpRight size={15} /></Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="upload-panel">
          <div className="flex items-start justify-between gap-4"><span className="shortcut-icon shortcut-icon-rose"><Upload size={21} /></span><StatusPill>本地上传</StatusPill></div>
          <h2 className="mt-5 text-lg font-semibold text-ink">上传视频文件</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">支持常见视频格式。处理完成后，原始视频和临时音频会被清理。</p>
          <label className="upload-dropzone mt-6">
            <input ref={fileInputRef} type="file" accept="video/*" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); setNotice('') }} />
            <span className="upload-dropzone-icon"><Upload size={21} /></span>
            <span className="text-sm font-semibold text-ink">{file ? file.name : '点击选择视频'}</span>
            <span className="text-xs text-stone-500">或拖拽文件到这里</span>
          </label>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500"><span>仅保留文件名与转写结果</span><span>文件大小和格式会校验</span></div>
          <div className="mt-5 flex justify-end"><SoftButton onClick={handleUpload} variant="primary"><Upload size={16} />{loading && uploadProgress !== null ? `上传中 ${uploadProgress}%` : '上传并转写'}</SoftButton></div>
        </Panel>
        <Panel className="upload-panel">
          <div className="flex items-start justify-between gap-4"><span className="shortcut-icon shortcut-icon-sand"><Link2 size={21} /></span><StatusPill>链接解析</StatusPill></div>
          <h2 className="mt-5 text-lg font-semibold text-ink">粘贴视频链接</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">保留原始视频链接，解析得到临时转写地址，不提供下载或素材保存。</p>
          <label className="form-field mt-6"><span>视频链接</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
          <div className="mt-5 flex justify-end"><SoftButton onClick={handleUrl}><Mic2 size={16} />开始转写</SoftButton></div>
        </Panel>
      </div>

      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}

      <Panel>
        <div className="section-label-row"><h2 className="section-label">最近一次任务</h2>{job ? <StatusPill tone={statusTone(job.status)}>{statusLabel(job.status)}</StatusPill> : <StatusPill tone="neutral">暂无任务</StatusPill>}</div>
        {!job ? (
          <div className="mt-5 grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center"><span className="transcribe-empty-icon"><FileText size={19} /></span><div><p className="text-sm font-medium text-ink">上传或粘贴链接后，任务会出现在这里</p><p className="mt-1 text-xs leading-5 text-stone-500">任务完成后可复制文字，或直接交给 Agent 继续拆解。</p></div><SoftButton href="/agent" variant="secondary"><WandSparkles size={15} />去 Agent 继续处理</SoftButton></div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{job.title || job.sourceFilename || '视频转写任务'}</p><p className="mt-1 break-all text-xs text-stone-500">{job.sourceKind === 'url' ? job.sourceUrl : job.sourceFilename}{job.createdAt ? ` · ${formatDate(job.createdAt)}` : ''}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="inline-action" onClick={copyResult} disabled={!job.resultText}><Clipboard size={15} />{copied ? '已复制' : '复制文字'}</button><button type="button" className="inline-action" onClick={handleDelete} disabled={deleting || job.status === 'processing'}><Trash2 size={15} />{deleting ? '删除中' : '删除'}</button>{job.status === 'failed' && <button type="button" className="inline-action" onClick={handleRetry} disabled={loading}><RefreshCw size={15} />重试</button>}</div></div>
            {(job.status === 'pending' || job.status === 'processing') && <div><div className="mb-2 flex items-center justify-between text-xs text-stone-500"><span className="inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" />{job.progressMessage || '处理中'}</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-rose-400 transition-all" style={{ width: `${progress}%` }} /></div></div>}
            {job.status === 'failed' && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{job.errorMessage || '转写任务失败'}{job.sourceKind === 'upload' && <span className="ml-1">本地文件失败后需要重新上传。</span>}</div>}
            {job.status === 'completed' && job.resultText && <div className="rounded-xl border border-stone-100 bg-white/70 p-4"><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-ink">{job.resultText}</pre><div className="mt-3 flex flex-wrap gap-2"><SoftButton href="/agent" variant="secondary"><WandSparkles size={15} />交给 Agent</SoftButton><SoftButton href={`/history?job=${encodeURIComponent(job.id)}`} variant="ghost"><Play size={15} />查看详情</SoftButton></div></div>}
            {job.status === 'completed' && !job.resultText && <p className="text-sm text-stone-500">任务完成，但暂未返回文字结果。</p>}
          </div>
        )}
      </Panel>
      <div className="grid gap-4 md:grid-cols-3"><div className="mini-info-card"><span><Play size={16} /></span><p><b>状态可见</b><small>排队、处理中和失败都有明确提示</small></p></div><div className="mini-info-card"><span><FileText size={16} /></span><p><b>文字可复制</b><small>结果可以继续优化、保存和引用</small></p></div><div className="mini-info-card"><span><Link2 size={16} /></span><p><b>链接会保留</b><small>本地视频仅保留原始文件名</small></p></div></div>
    </div>
  )
}
