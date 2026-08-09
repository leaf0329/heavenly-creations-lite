'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FolderOpen, LockKeyhole, Plus, UsersRound } from 'lucide-react'
import { EmptyState, PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'

type Item = { id: string; creatorId: string; visibility: 'team' | 'private'; category: 'copy' | 'script' | 'topic'; title: string; summary: string; tags: string[]; contentLength: number; content?: string }
type Form = { visibility: Item['visibility']; category: Item['category']; title: string; summary: string; content: string; tags: string }
const empty: Form = { visibility: 'team', category: 'copy', title: '', summary: '', content: '', tags: '' }

export function LibraryManager() {
  const [items, setItems] = useState<Item[]>([])
  const [category, setCategory] = useState<'all' | Item['category']>('all')
  const [form, setForm] = useState<Form>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const query = category === 'all' ? '' : `?category=${category}`
    const response = await fetch(`/api/library/items${query}`, { cache: 'no-store' })
    const payload = await response.json() as { items?: Item[]; error?: string }
    if (response.ok) setItems(payload.items || []); else setMessage(payload.error || '加载资料库失败')
  }, [category])
  useEffect(() => { void load() }, [load])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const body = { ...form, tags: form.tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean) }
    const response = await fetch(editing ? `/api/library/items/${editing}` : '/api/library/items', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json() as { error?: string }
    if (!response.ok) return setMessage(payload.error || '保存失败')
    setMessage('资料已保存'); setForm(empty); setEditing(null); setShowForm(false); await load()
  }

  async function edit(item: Item) {
    const response = await fetch(`/api/library/items/${item.id}`, { cache: 'no-store' })
    const payload = await response.json() as { item?: Item }
    if (!payload.item?.content) return setMessage('读取详情失败')
    setEditing(item.id); setShowForm(true); setForm({ visibility: payload.item.visibility, category: payload.item.category, title: payload.item.title, summary: payload.item.summary, content: payload.item.content, tags: payload.item.tags.join(', ') })
  }

  async function remove(item: Item) {
    if (!window.confirm(`确定删除“${item.title}”？`)) return
    const response = await fetch(`/api/library/items/${item.id}`, { method: 'DELETE' })
    if (response.ok) await load(); else setMessage('无权删除或条目不存在')
  }

  const team = items.filter((item) => item.visibility === 'team').length
  return <div className="space-y-7 pb-8">
    <PageIntro eyebrow="资料 / LIBRARY" title="团队资料库" description="收集文案、脚本和选题；团队共享内容可被 Agent 检索，私有内容只对自己可见。" action={<SoftButton onClick={() => { setEditing(null); setForm(empty); setShowForm(true) }}><Plus size={16} />新增资料</SoftButton>} />
    <div className="library-filters">{([['all', '全部'], ['copy', '文案'], ['script', '脚本'], ['topic', '选题']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setCategory(value)} className={`filter-chip ${category === value ? 'filter-chip-active' : ''}`}>{label}</button>)}</div>
    {showForm && <Panel><form className="grid gap-4" onSubmit={save}><div className="grid gap-4 md:grid-cols-2"><label className="form-field"><span>标题</span><input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field"><span>摘要</span><input maxLength={500} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><label className="form-field"><span>类型</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as Item['category'] })}><option value="copy">文案</option><option value="script">脚本</option><option value="topic">选题</option></select></label><label className="form-field"><span>可见范围</span><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as Item['visibility'] })}><option value="team">团队共享</option><option value="private">仅自己可见</option></select></label></div><label className="form-field"><span>标签（逗号分隔）</span><input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label><label className="form-field"><span>正文</span><textarea className="prompt-textarea" required rows={10} maxLength={200000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label><div className="flex gap-3"><SoftButton type="submit">保存</SoftButton><SoftButton variant="secondary" onClick={() => setShowForm(false)}>取消</SoftButton></div></form></Panel>}
    {message && <div className="info-callout"><BookOpen size={17} /><p>{message}</p></div>}
    <Panel>{!items.length ? <EmptyState icon={FolderOpen} title="资料库还是空的" description="把一段好用的文案、脚本或选题保存下来，下一次创作就能快速参考。" /> : <div className="divide-y divide-stone-100">{items.map((item) => <div key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{item.title}</p><StatusPill>{item.visibility === 'team' ? '团队' : '私有'}</StatusPill><StatusPill>{item.category === 'copy' ? '文案' : item.category === 'script' ? '脚本' : '选题'}</StatusPill></div><p className="mt-1 text-sm text-stone-500">{item.summary || `正文 ${item.contentLength} 字`}</p></div><div className="flex gap-2"><button className="inline-action" onClick={() => void edit(item)}>查看/编辑</button><button className="inline-action" onClick={() => void remove(item)}>删除</button></div></div>)}</div>}</Panel>
    <div className="grid gap-4 md:grid-cols-3"><div className="library-stat"><span><UsersRound size={17} /></span><p><b>当前页团队共享</b><small>所有成员可使用</small><strong>{team}</strong></p></div><div className="library-stat"><span><LockKeyhole size={17} /></span><p><b>当前页我的私有</b><small>只有自己可以查看</small><strong>{items.length - team}</strong></p></div><div className="library-stat"><span><BookOpen size={17} /></span><p><b>业务数量上限</b><small>文案、脚本、选题均不限</small><strong>∞</strong></p></div></div>
  </div>
}
