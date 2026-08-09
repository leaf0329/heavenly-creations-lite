'use client'

import { useEffect, useState } from 'react'
import { FileText, Library, Sparkles } from 'lucide-react'
import type { FeatureDefinition } from '../lib/features'
import { Panel, SoftButton, StatusPill } from './workspace-ui'

type Asset = { id: string; name: string; scope: 'system' | 'private'; summary: string }
type JobDetail = { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; resultText?: string | null; errorMessage?: string | null; progress?: number; progressMessage?: string }

export function CreateJobForm({ feature }: { feature: FeatureDefinition }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [skills, setSkills] = useState<Asset[]>([])
  const [profiles, setProfiles] = useState<Asset[]>([])
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [profileIds, setProfileIds] = useState<string[]>([])
  const [useLibrary, setUseLibrary] = useState(true)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void Promise.all([fetch('/api/skills'), fetch('/api/profiles')]).then(async ([skillResponse, profileResponse]) => {
      const skillPayload = await skillResponse.json() as { items?: Asset[] }
      const profilePayload = await profileResponse.json() as { items?: Asset[] }
      setSkills(skillPayload.items || []); setProfiles(profilePayload.items || [])
      setProfileIds((profilePayload.items || []).filter((item) => (item as Asset & { isDefault?: boolean }).isDefault).map((item) => item.id))
    })
  }, [])

  useEffect(() => {
    if (!job || !['pending', 'processing'].includes(job.status)) return
    const timer = window.setInterval(() => {
      void fetch(`/api/jobs/${job.id}`, { cache: 'no-store' }).then(async (response) => {
        const payload = await response.json() as { job?: JobDetail }
        if (payload.job) setJob(payload.job)
      })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job])

  const toggle = (id: string, selected: string[], setter: (ids: string[]) => void) => setter(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setJob(null)
    const response = await fetch(`/api/generations/${feature.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: values.theme || feature.label, values, skillIds, profileIds, useLibrary, librarySearch: values.theme || '' }) })
    const payload = await response.json() as { job?: JobDetail; jobId?: string; error?: string }
    if (!response.ok || !payload.jobId) return setError(payload.error || '提交失败')
    setJob({ ...(payload.job || {}), id: payload.jobId, status: payload.job?.status || 'pending' })
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
    <Panel><form onSubmit={submit} className="space-y-5"><div className="form-step"><span>01</span><div><p className="text-sm font-semibold text-ink">填写创作信息</p><p className="mt-1 text-xs text-stone-500">只会使用你填写的约束，不会擅自补充时长、字数或镜头格式。</p></div></div>{feature.fields.map((field) => <label key={field.key} className="form-field"><span>{field.label}</span>{field.type === 'textarea' ? <textarea className="prompt-textarea" rows={field.key === 'input' ? 9 : 5} value={values[field.key] || ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} placeholder={field.placeholder} /> : field.type === 'select' ? <select value={values[field.key] || ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}><option value="">请选择</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input value={values[field.key] || ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} placeholder={field.placeholder} />}</label>)}<div className="form-divider" /><div className="form-step"><span>02</span><div><p className="text-sm font-semibold text-ink">选择参考资产</p><p className="mt-1 text-xs text-stone-500">系统资产和你自己的私有资产会在服务端再次校验。</p></div></div>{skills.length > 0 && <div><p className="mb-2 text-xs font-semibold text-stone-500">SKILL</p><div className="flex flex-wrap gap-2">{skills.map((asset) => <button type="button" key={asset.id} className={`selection-chip ${skillIds.includes(asset.id) ? 'selection-chip-selected' : ''}`} onClick={() => toggle(asset.id, skillIds, setSkillIds)}><Sparkles size={14} />{asset.name}</button>)}</div></div>}{profiles.length > 0 && <div><p className="mb-2 text-xs font-semibold text-stone-500">PROFILE</p><div className="flex flex-wrap gap-2">{profiles.map((asset) => <button type="button" key={asset.id} className={`selection-chip ${profileIds.includes(asset.id) ? 'selection-chip-selected' : ''}`} onClick={() => toggle(asset.id, profileIds, setProfileIds)}><FileText size={14} />{asset.name}</button>)}</div></div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useLibrary} onChange={(event) => setUseLibrary(event.target.checked)} /><Library size={15} />参考团队资料库和我的私有资料</label><div className="flex justify-end"><SoftButton type="submit"><Sparkles size={16} />生成第一版</SoftButton></div></form></Panel>
    <aside className="space-y-5"><Panel><div className="section-label-row"><h2 className="section-label">生成结果</h2>{job && <StatusPill tone={job.status === 'completed' ? 'success' : job.status === 'processing' ? 'working' : 'neutral'}>{job.status}</StatusPill>}</div>{!job && !error && <p className="mt-5 text-sm leading-6 text-stone-500">提交后结果会显示在这里，并自动保存到你的历史记录。</p>}{error && <p className="mt-5 text-sm text-red-600">{error}</p>}{job && ['pending', 'processing'].includes(job.status) && <p className="mt-5 text-sm text-stone-500">{job.progressMessage || '排队处理中…'} {job.progress ?? 0}%</p>}{job?.status === 'failed' && <p className="mt-5 text-sm text-red-600">{job.errorMessage || '生成失败，请到历史记录重试'}</p>}{job?.status === 'completed' && <><pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7 text-ink">{job.resultText}</pre><button className="inline-action mt-4" onClick={() => void navigator.clipboard.writeText(job.resultText || '')}>复制结果</button></>}</Panel></aside>
  </div>
}
