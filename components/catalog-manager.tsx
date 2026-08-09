'use client'

import { useCallback, useEffect, useState } from 'react'
import { BriefcaseBusiness, FileText, Sparkles, Upload } from 'lucide-react'
import { useAuth } from './auth-context'
import { EmptyState, PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'
import { decodeMarkdownImport } from '@/lib/markdown-import'

type Kind = 'skills' | 'profiles'
type Item = { id: string; name: string; summary: string; scope: 'system' | 'private'; contentLength: number; category?: string; enabled?: boolean; isDefault?: boolean }
type Form = { name: string; summary: string; content: string; scope: 'system' | 'private'; category: string; enabled: boolean; isDefault: boolean }
const empty: Form = { name: '', summary: '', content: '', scope: 'private', category: 'general', enabled: true, isDefault: false }

export function CatalogManager({ kind }: { kind: Kind }) {
  const { isOwner } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [quota, setQuota] = useState<{ private?: { used: number; limit: number }; system?: { used: number; limit: number } }>({})
  const [form, setForm] = useState<Form>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const singular = kind === 'skills' ? 'Skill' : '门店档案'
  const icon = kind === 'skills' ? Sparkles : BriefcaseBusiness

  const load = useCallback(async () => {
    const response = await fetch(`/api/${kind}`, { cache: 'no-store' })
    const payload = await response.json() as { items?: Item[]; quota?: typeof quota; error?: string }
    if (response.ok) { setItems(payload.items || []); setQuota(payload.quota || {}) }
    else setMessage(payload.error || `加载 ${singular} 失败`)
  }, [kind, singular])
  useEffect(() => { void load() }, [load])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const body = kind === 'skills'
      ? { name: form.name, summary: form.summary, content: form.content, scope: form.scope, category: form.category, enabled: form.enabled }
      : { name: form.name, summary: form.summary, content: form.content, scope: form.scope, isDefault: form.isDefault }
    const response = await fetch(editing ? `/api/${kind}/${editing}` : `/api/${kind}`, {
      method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'scope')) : body),
    })
    const payload = await response.json() as { error?: string }
    if (!response.ok) return setMessage(payload.error || '保存失败')
    setMessage(`${singular} 已保存`); setForm(empty); setEditing(null); setShowForm(false); await load()
  }

  async function edit(item: Item) {
    const response = await fetch(`/api/${kind}/${item.id}`, { cache: 'no-store' })
    const payload = await response.json() as { skill?: Item & { content: string }; profile?: Item & { content: string } }
    const detail = kind === 'skills' ? payload.skill : payload.profile
    if (!detail) return setMessage('读取详情失败')
    setEditing(item.id); setShowForm(true); setForm({ name: detail.name, summary: detail.summary, content: detail.content, scope: detail.scope, category: detail.category || 'general', enabled: detail.enabled ?? true, isDefault: detail.isDefault ?? false })
  }

  async function remove(item: Item) {
    if (!window.confirm(`确定删除 ${item.name}？`)) return
    const response = await fetch(`/api/${kind}/${item.id}`, { method: 'DELETE' })
    if (response.ok) await load(); else setMessage('删除失败')
  }

  async function importMarkdown(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setImporting(true)
    try {
      const imported = decodeMarkdownImport(file.name, file.size, await file.arrayBuffer())
      if (form.content.trim() && !window.confirm('当前正文已有内容，是否用上传的 Markdown 文档覆盖？')) return
      setForm((current) => ({ ...current, name: imported.name, content: imported.content }))
      setMessage(`已导入 ${file.name}，保存前仍可继续编辑`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Markdown 文档导入失败')
    } finally {
      setImporting(false)
    }
  }

  return <div className="space-y-7 pb-8">
    <PageIntro eyebrow={`资料 / ${kind === 'skills' ? 'SKILL' : '门店档案'}`} title={singular} description={kind === 'skills' ? '保存可复用的写作方法，让 Agent 更懂你的工作习惯。' : '保存门店定位、服务特色与经营信息，创作时可以快速带入。'} action={<SoftButton onClick={() => { setEditing(null); setForm(empty); setShowForm(true) }}>新建 {singular}</SoftButton>} />
    <div className="flex flex-wrap gap-2"><StatusPill>个人 {quota.private?.used || 0}/{quota.private?.limit || 10}</StatusPill><StatusPill>系统 {quota.system?.used || 0}/{quota.system?.limit || 10}</StatusPill></div>
    {showForm && <Panel><form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 md:grid-cols-2"><label className="form-field"><span>名称</span><input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="form-field"><span>摘要</span><input maxLength={500} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label></div>
      {!editing && <label className="form-field"><span>范围</span><select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as Form['scope'] })}><option value="private">我的私有</option>{isOwner && <option value="system">系统共享</option>}</select></label>}
      {kind === 'skills' && <label className="form-field"><span>分类</span><input maxLength={100} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-stone-500">可手工填写，也可导入 UTF-8 编码的 .md 文档（最大 1MB，保留 Front Matter）。</p><label className="inline-action cursor-pointer"><Upload size={14} />{importing ? '正在导入…' : '上传 .md'}<input className="sr-only" type="file" accept=".md,text/markdown" disabled={importing} onChange={(event) => void importMarkdown(event)} /></label></div>
      <label className="form-field"><span>正文</span><textarea className="prompt-textarea" rows={9} required maxLength={100000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
      <div className="flex flex-wrap gap-4 text-sm">{kind === 'skills' ? <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> 启用</label> : <label><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} /> 设为默认门店档案</label>}</div>
      <div className="flex gap-3"><SoftButton type="submit">保存</SoftButton><SoftButton variant="secondary" onClick={() => setShowForm(false)}>取消</SoftButton></div>
    </form></Panel>}
    {message && <div className="info-callout"><FileText size={17} /><p>{message}</p></div>}
    <Panel>{!items.length ? <EmptyState icon={icon} title={`还没有 ${singular}`} description={`创建第一个${kind === 'skills' ? '写作方法' : '门店档案'}，之后可以在文案和 Agent 中选择使用。`} /> : <div className="divide-y divide-stone-100">{items.map((item) => <div key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold text-ink">{item.name}</p><StatusPill>{item.scope === 'system' ? '系统' : '私有'}</StatusPill>{item.isDefault && <StatusPill tone="success">默认</StatusPill>}</div><p className="mt-1 text-sm text-stone-500">{item.summary || `正文 ${item.contentLength} 字`}</p></div><div className="flex gap-2"><button className="inline-action" onClick={() => void edit(item)}>编辑</button><button className="inline-action" onClick={() => void remove(item)}>删除</button></div></div>)}</div>}</Panel>
  </div>
}
