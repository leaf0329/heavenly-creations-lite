'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { EmptyState, PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'

type Member = {
  id: string
  username: string
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string | null
}

type FormState = { username: string; displayName: string; password: string }
const emptyForm: FormState = { username: '', displayName: '', password: '' }

export function AdminUsersClient() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' })
      const payload = await response.json() as { members?: Member[]; error?: string }
      if (!response.ok) throw new Error(payload.error || '加载用户失败')
      setMembers(payload.members || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createMember(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const payload = await response.json() as { error?: string }
    if (!response.ok) return setMessage(payload.error || '创建失败')
    setForm(emptyForm)
    setShowCreate(false)
    setMessage('成员已创建')
    await load()
  }

  async function toggle(member: Member) {
    const status = member.status === 'active' ? 'disabled' : 'active'
    const response = await fetch(`/api/admin/users/${member.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (response.ok) await load()
  }

  async function resetPassword(member: Member) {
    const password = window.prompt(`为 ${member.username} 设置新密码（至少 12 个字符）`)
    if (!password) return
    const response = await fetch(`/api/admin/users/${member.id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    })
    const payload = await response.json() as { error?: string }
    setMessage(response.ok ? '密码已重置，成员的现有登录已退出' : payload.error || '重置失败')
  }

  async function remove(member: Member) {
    if (!window.confirm(`确定删除成员 ${member.username}？其个人数据将一并删除且无法恢复。`)) return
    const response = await fetch(`/api/admin/users/${member.id}`, { method: 'DELETE' })
    if (response.ok) await load()
  }

  const active = members.filter((item) => item.status === 'active').length
  return (
    <div className="space-y-7 pb-8">
      <PageIntro eyebrow="管理 / USERS" title="用户管理" description="主账户可以创建、停用、重置密码或删除团队成员。" action={<SoftButton onClick={() => setShowCreate((value) => !value)}><UserPlus size={16} />创建子用户</SoftButton>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="admin-stat"><span><UsersRound size={17} /></span><p><b>团队成员</b><strong>{members.length}</strong></p></div>
        <div className="admin-stat"><span><ShieldCheck size={17} /></span><p><b>启用中</b><strong>{active}</strong></p></div>
        <div className="admin-stat"><span><KeyRound size={17} /></span><p><b>已停用</b><strong>{members.length - active}</strong></p></div>
      </div>
      {showCreate && <Panel><form className="grid gap-4 sm:grid-cols-2" onSubmit={createMember}>
        <label className="grid gap-2 text-sm">用户名<input className="rounded-2xl border border-stone-200 bg-white px-4 py-3" required minLength={3} maxLength={50} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="仅字母、数字、._-" /></label>
        <label className="grid gap-2 text-sm">显示名称<input className="rounded-2xl border border-stone-200 bg-white px-4 py-3" maxLength={100} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
        <label className="grid gap-2 text-sm sm:col-span-2">初始密码<input className="rounded-2xl border border-stone-200 bg-white px-4 py-3" type="password" required minLength={12} maxLength={200} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <div className="sm:col-span-2"><SoftButton type="submit"><Plus size={16} />确认创建</SoftButton></div>
      </form></Panel>}
      {message && <div className="info-callout"><ShieldCheck size={17} /><p>{message}</p></div>}
      <Panel>
        <div className="section-label-row"><h2 className="section-label">成员列表</h2><StatusPill>{loading ? '加载中' : `${members.length} 人`}</StatusPill></div>
        {!loading && !members.length ? <EmptyState icon={UsersRound} title="还没有子用户" description="创建第一个成员账号后，团队成员就可以使用全部创作功能。" action={<SoftButton onClick={() => setShowCreate(true)}><Plus size={16} />创建子用户</SoftButton>} /> :
          <div className="divide-y divide-stone-100">{members.map((member) => <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-ink">{member.displayName || member.username}</p><p className="mt-1 text-sm text-stone-500">@{member.username} · {member.status === 'active' ? '启用中' : '已停用'}</p></div><div className="flex flex-wrap gap-2"><button className="inline-action" onClick={() => void resetPassword(member)}>重置密码</button><button className="inline-action" onClick={() => void toggle(member)}>{member.status === 'active' ? '停用' : '启用'}</button><button className="inline-action" onClick={() => void remove(member)}>删除</button></div></div>)}</div>}
      </Panel>
      <div className="info-callout"><ShieldCheck size={17} /><p>主账户无法查看子用户的对话、文案、转写、私有 Skill、Profile 或私有资料库内容。</p></div>
    </div>
  )
}
