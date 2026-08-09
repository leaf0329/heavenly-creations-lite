'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Clipboard, FileText, History as HistoryIcon, Loader2, Mic2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { EmptyState, PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'

type JobSummary = {
  id: string
  type: string
  status: string
  title: string
  progress?: number
  progressMessage?: string
  attemptCount?: number
  maxAttempts?: number
  queuePosition?: number | null
  sourceKind?: string
  sourceUrl?: string | null
  sourceFilename?: string | null
  errorMessage?: string | null
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
  updatedAt?: string
}

type JobDetail = JobSummary & {
  input?: Record<string, unknown>
  resultText?: string | null
  sourceMetadata?: Record<string, unknown>
}

type ApiPayload = { ok?: boolean; jobs?: JobSummary[]; items?: JobSummary[]; job?: JobDetail; error?: string; code?: string }
type HistoryTab = 'all' | 'copy' | 'stt' | 'agent'

const TEXT_TYPES = new Set(['topic-plan', 'topics', 'stt-rewrite', 'xiaohongshu-copy', 'moments-copy', 'sales-script'])

function parseType(type: string): string {
  const labels: Record<string, string> = {
    'topic-plan': '爆款选题',
    topics: '同城脚本',
    'stt-rewrite': '文案拆解',
    'xiaohongshu-copy': '小红书文案',
    'moments-copy': '朋友圈文案',
    'sales-script': '成交话术',
    stt: '视频转写',
  }
  return labels[type] || type
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

async function readPayload(response: Response): Promise<ApiPayload> {
  const body: unknown = await response.json().catch(() => null)
  return body && typeof body === 'object' ? body as ApiPayload : {}
}

export default function HistoryClient() {
  const [tab, setTab] = useState<HistoryTab>('all')
  const [search, setSearch] = useState('')
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [actionId, setActionId] = useState('')

  const loadJobs = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ limit: '100' })
    if (search.trim()) params.set('search', search.trim())
    try {
      const response = await fetch(`/api/jobs?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
      const payload = await readPayload(response)
      if (!response.ok) throw new Error(payload.error || '获取历史记录失败')
      setJobs(payload.jobs || payload.items || [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : '获取历史记录失败') }
    finally { setLoading(false) }
  }, [search])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadJobs() }, search ? 300 : 0)
    return () => window.clearTimeout(timeout)
  }, [loadJobs, search])

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    if (tab === 'stt') return job.type === 'stt'
    if (tab === 'copy') return TEXT_TYPES.has(job.type)
    return tab === 'all'
  }), [jobs, tab])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' })
      const payload = await readPayload(response)
      if (!response.ok || !payload.job) throw new Error(payload.error || '读取任务详情失败')
      setDetail(payload.job)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取任务详情失败') }
    finally { setDetailLoading(false) }
  }

  const updateSummary = (updated: JobSummary) => setJobs((current) => current.map((job) => job.id === updated.id ? { ...job, ...updated } : job))

  const retry = async (job: JobSummary) => {
    setActionId(job.id)
    setError('')
    setNotice('')
    const endpoint = job.type === 'stt' ? `/api/transcriptions/${encodeURIComponent(job.id)}/retry` : `/api/jobs/${encodeURIComponent(job.id)}/retry`
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include' })
      const payload = await readPayload(response)
      if (!response.ok) {
        if (payload.code === 'reupload_required') throw new Error('本地上传文件已清理，请重新上传视频')
        throw new Error(payload.error || '任务当前不可重试')
      }
      if (payload.job) {
        updateSummary(payload.job)
        if (detail?.id === job.id) setDetail(payload.job)
      }
      setNotice('任务已重新排队')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务重试失败') }
    finally { setActionId('') }
  }

  const remove = async (job: JobSummary) => {
    setActionId(job.id)
    setError('')
    setNotice('')
    const endpoint = job.type === 'stt' ? `/api/transcriptions/${encodeURIComponent(job.id)}` : `/api/jobs/${encodeURIComponent(job.id)}`
    try {
      const response = await fetch(endpoint, { method: 'DELETE', credentials: 'include' })
      const payload = await readPayload(response)
      if (!response.ok) throw new Error(payload.error || '删除任务失败')
      setJobs((current) => current.filter((item) => item.id !== job.id))
      if (detail?.id === job.id) { setDetail(null); setSelectedId('') }
      setNotice('任务已删除')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除任务失败') }
    finally { setActionId('') }
  }

  const copy = async () => {
    const text = detail?.resultText || ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { setError('复制失败，请手动选择文字') }
  }

  const counts = useMemo(() => ({ all: jobs.length, copy: jobs.filter((job) => TEXT_TYPES.has(job.type)).length, stt: jobs.filter((job) => job.type === 'stt').length }), [jobs])

  return (
    <div className="space-y-7 pb-8">
      <PageIntro eyebrow="WORKSPACE / HISTORY" title="历史记录" description="所有内容只属于你，随时回来继续优化。" action={<label className="history-search"><Search size={16} /><input aria-label="搜索标题或内容" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或内容" /></label>} />
      <div className="history-tabs" role="tablist">
        {([['all', `全部 (${counts.all})`], ['copy', `文案 (${counts.copy})`], ['agent', 'Agent 对话'], ['stt', `转写 (${counts.stt})`]] as const).map(([value, label]) => <button key={value} className={`history-tab ${tab === value ? 'history-tab-active' : ''}`} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}
      </div>
      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}
      {tab === 'agent' ? (
        <Panel><EmptyState icon={Bot} title="Agent 对话暂在 Agent 页管理" description="对话、消息与资产选择都集中在 Agent 工作区，打开后可以继续最近的对话。" action={<SoftButton href="/agent"><Bot size={16} />打开 Agent</SoftButton>} /></Panel>
      ) : loading ? (
        <Panel><div className="flex min-h-48 items-center justify-center gap-2 text-sm text-stone-500"><Loader2 size={18} className="animate-spin" />正在读取历史记录…</div></Panel>
      ) : filteredJobs.length === 0 ? (
        <Panel><EmptyState icon={HistoryIcon} title={search ? '没有匹配的任务' : '还没有历史记录'} description={search ? '尝试更换关键词，或清空搜索后再试。' : '完成一次文案创作或视频转写后，结果会自动保存在这里。'} action={!search && <div className="flex flex-wrap justify-center gap-3"><SoftButton href="/agent"><Bot size={16} />开始对话</SoftButton><SoftButton href="/create" variant="secondary"><FileText size={16} />开始创作</SoftButton></div>} /></Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <Panel className="overflow-hidden p-0"><div className="divide-y divide-stone-100">{filteredJobs.map((job) => <div key={job.id} className={`flex min-w-0 flex-wrap items-center gap-3 px-4 py-4 transition hover:bg-white/70 ${selectedId === job.id ? 'bg-white/70' : ''}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openDetail(job.id)}><div className="flex min-w-0 items-center gap-3"><span className="transcribe-empty-icon">{job.type === 'stt' ? <Mic2 size={17} /> : <FileText size={17} />}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{job.title || parseType(job.type)}</span><span className="mt-1 block truncate text-xs text-stone-500">{parseType(job.type)} · {formatDate(job.createdAt)}</span></span></div></button><StatusPill tone={statusTone(job.status)}>{statusLabel(job.status)}</StatusPill><div className="flex items-center gap-2"><button type="button" className="inline-action" onClick={() => void openDetail(job.id)}>详情</button>{job.status === 'failed' && <button type="button" className="inline-action" disabled={actionId === job.id} onClick={() => void retry(job)}><RefreshCw size={14} />重试</button>}<button type="button" className="inline-action" disabled={actionId === job.id || job.status === 'processing'} onClick={() => void remove(job)}><Trash2 size={14} />删除</button></div></div>)}</div></Panel>
          <Panel className="min-w-0">
            {!selectedId ? <div className="flex min-h-48 items-center justify-center text-center text-sm text-stone-500">点击左侧任务查看详情。<br />列表摘要不包含完整正文。</div> : detailLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-stone-500"><Loader2 size={17} className="animate-spin" />正在读取任务详情…</div> : detail ? <div className="space-y-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-base font-semibold text-ink">{detail.title || parseType(detail.type)}</p><p className="mt-1 text-xs text-stone-500">{parseType(detail.type)} · {formatDate(detail.createdAt)}</p></div><StatusPill tone={statusTone(detail.status)}>{statusLabel(detail.status)}</StatusPill></div>{detail.sourceUrl && <a className="block break-all text-xs text-rose-700 underline" href={detail.sourceUrl} target="_blank" rel="noreferrer">{detail.sourceUrl}</a>}{detail.status === 'failed' && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detail.errorMessage || '任务处理失败'}{detail.type === 'stt' && detail.sourceKind === 'upload' && <span className="ml-1">本地文件已清理，请重新上传视频。</span>}</div>}{(detail.status === 'pending' || detail.status === 'processing') && <div className="rounded-xl bg-stone-50 px-3 py-3 text-sm text-stone-600">{detail.progressMessage || '任务处理中'}{typeof detail.progress === 'number' && <span className="ml-2">{detail.progress}%</span>}</div>}{detail.status === 'completed' && detail.resultText ? <div><pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-stone-100 bg-white/70 p-4 text-sm leading-7 text-ink">{detail.resultText}</pre><button type="button" className="inline-action mt-3" onClick={copy}><Clipboard size={15} />{copied ? '已复制' : '复制全文'}</button></div> : detail.status === 'completed' ? <p className="text-sm text-stone-500">任务已完成，但详情没有返回正文。</p> : null}<div className="flex flex-wrap gap-2">{detail.status === 'failed' && <SoftButton onClick={() => void retry(detail)} variant="secondary"><RefreshCw size={15} />重试</SoftButton>}<SoftButton onClick={() => void remove(detail)} variant="ghost"><Trash2 size={15} />删除任务</SoftButton></div></div> : null}
          </Panel>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3"><div className="history-summary"><span><FileText size={16} /></span><div><b>文案</b><strong>{counts.copy}</strong></div></div><div className="history-summary"><span><Bot size={16} /></span><div><b>对话</b><strong>在 Agent</strong></div></div><div className="history-summary"><span><Mic2 size={16} /></span><div><b>转写</b><strong>{counts.stt}</strong></div></div></div>
    </div>
  )
}
