'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bot, Check, Clipboard, FileText, Library, Loader2, MessageSquare, Mic2, Plus, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { PageIntro, Panel, SelectionChip, SoftButton, StatusPill } from './workspace-ui'

const AGENT_ASSET_NOTICE = '本对话不再弹出选择，直接使用当前已选择资产'
const suggestions = ['帮我找一个适合周末发布的选题', '把这段内容改得更自然一点', '拆解一条同城爆款视频']

type ConversationSummary = { id: string; title: string; messageCount?: number; lastMessageAt?: string | null; createdAt?: string; updatedAt?: string }
type AgentMessage = { id: string; conversationId: string; role: 'user' | 'assistant' | 'system' | 'tool' | string; content: string; metadata?: Record<string, unknown>; createdAt?: string }
type SelectableAsset = { id: string; name: string; summary?: string; scope?: string; category?: string }
type AssetSelection = { skillIds: string[]; profileIds: string[]; libraryItemIds: string[] }
type AssetOptions = { skills: SelectableAsset[]; profiles: SelectableAsset[]; libraryItems: SelectableAsset[] }
type AssetStatus = AssetSelection & { confirmed?: boolean; source?: string; requiresAssetSelection?: boolean; notice?: string; available?: AssetOptions }
type ConversationDetail = ConversationSummary & { messages: AgentMessage[]; assetSelection?: AssetStatus }
type JobStatus = { id: string; status: string; progress?: number; progressMessage?: string; errorMessage?: string | null }
type ApiPayload = { ok?: boolean; conversation?: ConversationSummary | ConversationDetail; conversations?: ConversationSummary[]; items?: ConversationSummary[]; messages?: AgentMessage[]; assetSelection?: AssetStatus; selection?: AssetStatus | AssetOptions; requiresAssetSelection?: boolean; notice?: string; message?: AgentMessage; job?: JobStatus; jobId?: string; error?: string; code?: string }

function blankSelection(): AssetSelection { return { skillIds: [], profileIds: [], libraryItemIds: [] } }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function normalizeStatus(value: unknown): AssetStatus | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    skillIds: strings(record.skillIds), profileIds: strings(record.profileIds), libraryItemIds: strings(record.libraryItemIds),
    confirmed: record.confirmed === true, source: typeof record.source === 'string' ? record.source : undefined,
    requiresAssetSelection: record.requiresAssetSelection === true, notice: typeof record.notice === 'string' ? record.notice : undefined,
    available: normalizeOptions(record.available),
  }
}
function normalizeAsset(value: unknown): SelectableAsset | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') return null
  return { id: record.id, name: record.name, summary: typeof record.summary === 'string' ? record.summary : '', scope: typeof record.scope === 'string' ? record.scope : undefined, category: typeof record.category === 'string' ? record.category : undefined }
}
function normalizeOptions(value: unknown): AssetOptions | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const list = (key: string) => Array.isArray(record[key]) ? record[key].map(normalizeAsset).filter((item): item is SelectableAsset => Boolean(item)) : []
  return { skills: list('skills'), profiles: list('profiles'), libraryItems: list('libraryItems') }
}
function extractOptions(payload: ApiPayload): AssetOptions | undefined {
  const status = normalizeStatus(payload.assetSelection)
  if (status?.available) return status.available
  const direct = normalizeOptions(payload.selection)
  if (direct) return direct
  const selectionStatus = normalizeStatus(payload.selection)
  return selectionStatus?.available
}
function extractStatus(payload: ApiPayload): AssetStatus | null { return normalizeStatus(payload.assetSelection) || normalizeStatus(payload.selection) }
function initialDraft(status?: AssetStatus | null): AssetSelection {
  return { skillIds: status?.skillIds || [], profileIds: status?.profileIds || [], libraryItemIds: status?.libraryItemIds || [] }
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

function AssetCheckboxes({ options, draft, onChange }: { options: AssetOptions; draft: AssetSelection; onChange: (next: AssetSelection) => void }) {
  const groups: Array<{ key: keyof AssetOptions; label: string; ids: keyof AssetSelection }> = [
    { key: 'skills', label: 'Skill', ids: 'skillIds' },
    { key: 'profiles', label: '门店档案', ids: 'profileIds' },
    { key: 'libraryItems', label: '资料库', ids: 'libraryItemIds' },
  ]
  return <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">{groups.map((group) => <fieldset key={group.key}><legend className="mb-2 text-xs font-semibold text-stone-600">{group.label}</legend>{options[group.key].length === 0 ? <p className="text-xs text-stone-400">暂无可选资产</p> : <div className="space-y-2">{options[group.key].map((asset) => { const selected = draft[group.ids].includes(asset.id); return <label key={asset.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${selected ? 'border-rose-200 bg-rose-50/60' : 'border-stone-100 bg-white/70 hover:border-rose-100'}`}><input type="checkbox" checked={selected} onChange={(event) => { const values = event.target.checked ? [...draft[group.ids], asset.id] : draft[group.ids].filter((id) => id !== asset.id); onChange({ ...draft, [group.ids]: values }) }} className="mt-1 accent-rose-500" /><span className="min-w-0"><span className="block text-sm font-medium text-ink">{asset.name}</span>{asset.summary && <span className="mt-0.5 block text-xs leading-5 text-stone-500">{asset.summary}</span>}</span></label> })}</div>}</fieldset>)}</div>
}

export default function AgentClient() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversation, setConversation] = useState<ConversationDetail | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [messageText, setMessageText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingJob, setPendingJob] = useState<JobStatus | null>(null)
  const [assetOptions, setAssetOptions] = useState<AssetOptions | null>(null)
  const [draftAssets, setDraftAssets] = useState<AssetSelection>(blankSelection())
  const [assetDialogOpen, setAssetDialogOpen] = useState(false)
  const [pendingAssetMessage, setPendingAssetMessage] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const initialized = useRef(false)

  const loadConversation = useCallback(async (id: string) => {
    if (!id) return
    const response = await fetch(`/api/agent/conversations/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' })
    const payload = await readPayload(response)
    if (!response.ok || !payload.conversation) throw new Error(payload.error || '读取对话失败')
    const raw = payload.conversation as ConversationDetail
    setConversation({ ...raw, messages: Array.isArray(raw.messages) ? raw.messages : [] })
    setSelectedId(id)
    const status = normalizeStatus(raw.assetSelection)
    if (status?.notice) setNotice(status.notice)
  }, [])

  const createConversation = useCallback(async () => {
    const response = await fetch('/api/agent/conversations', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '' }) })
    const payload = await readPayload(response)
    if (!response.ok || !payload.conversation) throw new Error(payload.error || '创建对话失败')
    const item = payload.conversation as ConversationSummary
    setConversations((current) => [item, ...current.filter((conversationItem) => conversationItem.id !== item.id)])
    await loadConversation(item.id)
  }, [loadConversation])

  const loadConversations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/agent/conversations?limit=50', { credentials: 'include', cache: 'no-store' })
      const payload = await readPayload(response)
      if (!response.ok) throw new Error(payload.error || '读取对话列表失败')
      const list = payload.conversations || payload.items || []
      setConversations(list)
      if (selectedId && list.some((item) => item.id === selectedId)) await loadConversation(selectedId)
      else if (list[0]) await loadConversation(list[0].id)
      else await createConversation()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取对话失败') }
    finally { setLoading(false) }
  }, [createConversation, loadConversation, selectedId])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!pendingJob || (pendingJob.status !== 'pending' && pendingJob.status !== 'processing')) return
    let cancelled = false
    const poll = async () => {
      const response = await fetch(`/api/jobs/${encodeURIComponent(pendingJob.id)}`, { credentials: 'include', cache: 'no-store' })
      if (!response.ok || cancelled) return
      const payload = await readPayload(response)
      const next = payload.job
      if (!next) return
      if (next.status === 'completed' || next.status === 'failed') {
        setPendingJob(next)
        if (conversation?.id) void loadConversation(conversation.id)
      } else setPendingJob(next)
    }
    const interval = window.setInterval(() => { void poll() }, 2000)
    void poll()
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [conversation?.id, loadConversation, pendingJob])

  const sendMessage = async (content: string, extra: { assetSelection?: AssetSelection; confirmAssets?: boolean } = {}) => {
    const clean = content.trim()
    if (!clean || !selectedId || sending) return false
    setSending(true)
    setError('')
    try {
      const response = await fetch(`/api/agent/conversations/${encodeURIComponent(selectedId)}/messages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        // Keep the user's message verbatim. No output-format instruction is appended here.
        body: JSON.stringify({ content: clean, ...extra }),
      })
      const payload = await readPayload(response)
      if (response.status === 409 && payload.requiresAssetSelection) {
        const status = extractStatus(payload)
        const options = extractOptions(payload)
        if (!options) throw new Error('需要选择资产，但当前没有可选资产')
        setAssetOptions(options)
        setDraftAssets(initialDraft(status))
        setPendingAssetMessage(clean)
        setAssetDialogOpen(true)
        return false
      }
      if (!response.ok) throw new Error(payload.error || '发送 Agent 消息失败')
      if (payload.job || payload.jobId) setPendingJob(payload.job || { id: payload.jobId || '', status: 'pending' })
      setMessageText('')
      if (payload.notice) setNotice(payload.notice)
      await loadConversation(selectedId)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送 Agent 消息失败')
      return false
    } finally { setSending(false) }
  }

  const submit = async () => { await sendMessage(messageText) }

  const confirmAssets = async () => {
    if (!selectedId || !assetOptions || !pendingAssetMessage) return
    setSending(true)
    setError('')
    try {
      const response = await fetch(`/api/agent/conversations/${encodeURIComponent(selectedId)}/assets`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftAssets),
      })
      const payload = await readPayload(response)
      if (!response.ok) throw new Error(payload.error || '确认资产选择失败')
      setNotice(AGENT_ASSET_NOTICE)
      setAssetDialogOpen(false)
      const text = pendingAssetMessage
      setPendingAssetMessage('')
      // Reuse the same conversation and the exact original user text.
      await sendMessage(text, { assetSelection: draftAssets, confirmAssets: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认资产选择失败') }
    finally { setSending(false) }
  }

  const chooseConversation = async (id: string) => {
    if (id === selectedId) return
    setError('')
    try { await loadConversation(id) } catch (reason) { setError(reason instanceof Error ? reason.message : '读取对话失败') }
  }

  const deleteConversation = async () => {
    if (!conversation || sending) return
    setSending(true)
    try {
      const response = await fetch(`/api/agent/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE', credentials: 'include' })
      const payload = await readPayload(response)
      if (!response.ok) throw new Error(payload.error || '删除对话失败')
      const next = conversations.filter((item) => item.id !== conversation.id)
      setConversations(next)
      setConversation(null)
      setSelectedId('')
      if (next[0]) await loadConversation(next[0].id)
      else await createConversation()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除对话失败') }
    finally { setSending(false) }
  }

  const copyMessage = async (message: AgentMessage) => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedId(message.id)
      window.setTimeout(() => setCopiedId(''), 1600)
    } catch { setError('复制失败，请手动选择文字') }
  }

  const currentAssets = normalizeStatus(conversation?.assetSelection)
  const optionsForDialog = assetOptions || currentAssets?.available || { skills: [], profiles: [], libraryItems: [] }

  return (
    <div className="space-y-7 pb-8">
      <PageIntro eyebrow="WORKSPACE / AGENT" title="文案 Agent" description="和一个懂团队语气的写作伙伴一起，把想法整理成能直接使用的内容。" action={<SoftButton href="/history" variant="secondary"><FileText size={16} />查看历史</SoftButton>} />
      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="agent-panel">
          <div className="agent-header"><div className="flex min-w-0 items-center gap-3"><span className="agent-avatar"><Bot size={20} /></span><div className="min-w-0"><p className="font-semibold text-ink">美咖文案助手</p><p className="text-xs text-stone-500">{conversation?.title || '可以从一句话开始'}</p></div></div><div className="flex items-center gap-2"><StatusPill tone="success"><span className="status-dot" />在线</StatusPill>{conversation && <button type="button" className="inline-action" aria-label="删除当前对话" onClick={() => void deleteConversation()} disabled={sending}><Trash2 size={15} />删除</button>}</div></div>
          <div className="border-b border-stone-100 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-semibold text-stone-500" htmlFor="conversation-select">当前对话</label><select id="conversation-select" className="min-h-9 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white/80 px-2 text-sm text-ink" value={selectedId} onChange={(event) => void chooseConversation(event.target.value)} disabled={loading || conversations.length === 0}>{conversations.map((item) => <option key={item.id} value={item.id}>{item.title || '未命名对话'}</option>)}</select><button type="button" className="inline-action" onClick={() => void createConversation()} disabled={sending}><Plus size={15} />新对话</button></div></div>
          <div className="agent-empty !min-h-0 items-stretch justify-start gap-3 overflow-y-auto px-4 py-5 text-left sm:min-h-[375px]" aria-live="polite">
            {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-stone-500"><Loader2 size={18} className="animate-spin" />正在读取对话…</div> : conversation?.messages?.length ? conversation.messages.map((message) => <div key={message.id} className={`group flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-3.5 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-rose-100 text-rose-950' : 'border border-stone-100 bg-white/80 text-ink'}`}><p className="whitespace-pre-wrap break-words">{message.content}</p><div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-stone-400"><span>{message.role === 'user' ? '你' : 'Agent'}{message.createdAt ? ` · ${formatDate(message.createdAt)}` : ''}</span><button type="button" className="inline-flex items-center gap-1 text-stone-400 hover:text-rose-600" onClick={() => void copyMessage(message)}><Clipboard size={12} />{copiedId === message.id ? '已复制' : '复制'}</button></div></div></div>) : <div className="flex min-h-56 flex-col items-center justify-center text-center"><span className="agent-empty-orb"><Sparkles size={23} /></span><h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">今天想写点什么？</h2><p className="mt-2 max-w-md text-sm leading-6 text-stone-500">可以描述一个主题、贴一段原文，或者直接告诉我你想达到的效果。</p><div className="mt-6 flex flex-wrap justify-center gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="selection-chip" onClick={() => setMessageText(suggestion)}>{suggestion}</button>)}</div></div>}
            {pendingJob && (pendingJob.status === 'pending' || pendingJob.status === 'processing') && <div className="flex items-center gap-2 text-xs text-stone-500"><Loader2 size={14} className="animate-spin" />{pendingJob.progressMessage || 'Agent 正在生成…'}{typeof pendingJob.progress === 'number' ? ` ${pendingJob.progress}%` : ''}</div>}
            {pendingJob?.status === 'failed' && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{pendingJob.errorMessage || 'Agent 任务失败'}<button type="button" className="ml-2 inline-action" onClick={() => void loadConversation(selectedId)}><RefreshCw size={13} />刷新对话</button></div>}
          </div>
          <div className="agent-composer"><textarea className="agent-textarea" rows={4} value={messageText} onChange={(event) => setMessageText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="输入你的想法，例如：给我 3 个适合春季护理的同城选题…" disabled={!selectedId || sending} /><div className="agent-composer-footer"><div className="flex flex-wrap items-center gap-2"><span className="composer-hint">可参考</span><SelectionChip><Sparkles size={14} />Skill</SelectionChip><SelectionChip><FileText size={14} />门店档案</SelectionChip><SelectionChip><Library size={14} />资料库</SelectionChip></div><button type="button" className="composer-send" aria-label="发送消息" onClick={() => void submit()} disabled={!messageText.trim() || !selectedId || sending}>{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button></div></div>
        </Panel>

        <aside className="space-y-5"><Panel><div className="section-label-row"><h2 className="section-label">对话历史</h2><button type="button" className="inline-action" onClick={() => void createConversation()} disabled={sending}><Plus size={14} />新建</button></div><div className="mt-4 space-y-1">{conversations.length === 0 ? <p className="text-sm text-stone-500">暂无对话</p> : conversations.map((item) => <button type="button" key={item.id} onClick={() => void chooseConversation(item.id)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${item.id === selectedId ? 'bg-rose-50 text-rose-800' : 'text-stone-600 hover:bg-stone-50'}`}><MessageSquare size={15} /><span className="min-w-0 flex-1 truncate text-sm">{item.title || '未命名对话'}</span><span className="text-[10px] text-stone-400">{item.messageCount || 0}</span></button>)}</div></Panel><Panel><div className="section-label-row"><h2 className="section-label">当前资产</h2>{currentAssets?.requiresAssetSelection && currentAssets.available && <button type="button" className="inline-action" onClick={() => { setAssetOptions(currentAssets.available || null); setDraftAssets(initialDraft(currentAssets)); setPendingAssetMessage(''); setAssetDialogOpen(true) }}>选择</button>}</div>{currentAssets?.confirmed ? <><p className="mt-3 text-xs leading-5 text-stone-500">本对话已确认资产，后续消息会继续复用。</p><p className="mt-2 text-xs font-semibold text-emerald-700">{AGENT_ASSET_NOTICE}</p></> : currentAssets?.source === 'default' ? <p className="mt-3 text-xs leading-5 text-stone-500">正在使用默认门店档案。发送消息时可以按需确认资产。</p> : <p className="mt-3 text-xs leading-5 text-stone-500">首次发送时会提示选择 Skill、门店档案或资料库。</p>}<div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-stone-500"><span><b className="block text-base text-ink">{currentAssets?.skillIds.length || 0}</b>Skill</span><span><b className="block text-base text-ink">{currentAssets?.profileIds.length || 0}</b>门店档案</span><span><b className="block text-base text-ink">{currentAssets?.libraryItemIds.length || 0}</b>资料</span></div></Panel><Panel className="soft-note"><span className="soft-note-icon"><Sparkles size={16} /></span><p className="text-sm font-semibold text-ink">先选资产，再开始对话</p><p className="mt-2 text-xs leading-5 text-stone-500">在对话中选择 Skill 或门店档案，Agent 会在本次对话里记住你的选择。</p></Panel><div className="space-y-2"><Link href="/create" className="agent-side-link"><span className="agent-side-icon"><FileText size={16} /></span><span><b>开始一类文案</b><small>使用固定创作方式</small></span><ArrowUpRight size={15} /></Link><Link href="/transcribe" className="agent-side-link"><span className="agent-side-icon"><Mic2 size={16} /></span><span><b>视频转文字</b><small>把视频变成可编辑的文字</small></span><ArrowUpRight size={15} /></Link></div></aside>
      </div>

      {assetDialogOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/35 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="asset-dialog-title"><div className="w-full max-w-xl rounded-2xl border border-white/60 bg-[#fbf8f4] p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 id="asset-dialog-title" className="text-base font-semibold text-ink">选择本次对话使用的资产</h2><p className="mt-1 text-xs leading-5 text-stone-500">确认后将继续使用这些资产，不会重复弹窗。</p></div><button type="button" className="inline-action" onClick={() => { setAssetDialogOpen(false); setPendingAssetMessage('') }} aria-label="关闭资产选择"><X size={17} /></button></div><div className="mt-4"><AssetCheckboxes options={optionsForDialog} draft={draftAssets} onChange={setDraftAssets} /></div><p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">{AGENT_ASSET_NOTICE}</p><div className="mt-5 flex flex-wrap justify-end gap-2"><SoftButton variant="ghost" onClick={() => { setAssetDialogOpen(false); setPendingAssetMessage('') }}>取消</SoftButton><SoftButton onClick={() => void confirmAssets()}><Check size={15} />确认并发送</SoftButton></div></div></div>}
    </div>
  )
}
