'use client'

import { useEffect, useState } from 'react'
import { Globe2, KeyRound, Mic2, Network, Save, ShieldCheck, Sparkles } from 'lucide-react'
import { PageIntro, Panel, SoftButton, StatusPill } from './workspace-ui'

const services = [
  { id: 'text', title: '文案生成模型', description: '六类文案和常规生成任务使用的模型。', icon: Sparkles },
  { id: 'agent', title: 'Agent 主模型', description: 'Agent 对话与工具编排使用的模型。', icon: Network },
  { id: 'audio', title: '语音转写模型', description: '视频转文字任务使用的音频模型。', icon: Mic2 },
  { id: 'video_parser', title: 'TikHub 视频解析', description: '解析抖音、小红书、快手、B站、西瓜/头条、视频号和微博链接。', icon: Globe2 },
] as const
type ServiceId = typeof services[number]['id']
type Config = { service: ServiceId; provider: string; endpoint: string; model: string; enabled: boolean; hasKey: boolean; options: Record<string, unknown> }
const blank = (service: ServiceId): Config => ({
  service,
  provider: service === 'video_parser' ? 'tikhub' : '',
  endpoint: service === 'video_parser' ? 'https://api.tikhub.dev' : '',
  model: '', enabled: true, hasKey: false, options: {},
})

export function ApiConfigClient() {
  const [configs, setConfigs] = useState<Record<ServiceId, Config>>(() => Object.fromEntries(services.map(({ id }) => [id, blank(id)])) as Record<ServiceId, Config>)
  const [selected, setSelected] = useState<ServiceId>('text')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void fetch('/api/admin/config', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as { configs?: Config[] }
      if (!response.ok) return
      setConfigs((current) => ({ ...current, ...Object.fromEntries((payload.configs || []).map((item) => [item.service, item])) }))
    })
  }, [])

  const current = configs[selected]
  const update = (patch: Partial<Config>) => setConfigs((all) => ({ ...all, [selected]: { ...all[selected], ...patch } }))

  async function save() {
    setMessage('')
    const response = await fetch(`/api/admin/config/${selected}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: current.provider, endpoint: current.endpoint, model: current.model, enabled: current.enabled, options: current.options, ...(apiKey ? { apiKey } : {}) }),
    })
    const payload = await response.json() as { config?: Config; error?: string }
    if (response.ok && payload.config) {
      setConfigs((all) => ({ ...all, [selected]: payload.config! }))
      setApiKey('')
      setMessage('配置已加密保存')
    } else setMessage(payload.error || '保存失败')
  }

  async function validate() {
    const response = await fetch(`/api/admin/config/${selected}/test`, { method: 'POST' })
    const payload = await response.json() as { ok?: boolean; error?: string }
    setMessage(payload.ok ? '本地配置校验通过；实际调用时会继续验证供应商连接' : payload.error || '配置不完整')
  }

  return <div className="space-y-7 pb-8">
    <PageIntro eyebrow="管理 / API" title="API 配置" description="统一管理团队共享的文本、Agent、转写和视频链接解析服务。" action={<SoftButton onClick={() => void save()}><Save size={16} />保存当前服务</SoftButton>} />
    <div className="info-callout"><ShieldCheck size={17} /><p>密钥采用 AES-256-GCM 加密保存，接口仅返回“是否已配置”，不会回显密钥；子用户无法访问此页面。</p></div>
    <Panel><div className="section-label-row"><h2 className="section-label">共享服务</h2><StatusPill>4 项服务</StatusPill></div><div className="mt-5 space-y-3">{services.map(({ id, title, description, icon: Icon }) => <button key={id} type="button" onClick={() => { setSelected(id); setApiKey(''); setMessage('') }} className={`service-row w-full text-left ${selected === id ? 'ring-2 ring-rose-200' : ''}`}><span className="service-row-icon"><Icon size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-ink">{title}</p><StatusPill tone={configs[id].hasKey ? 'success' : 'neutral'}>{configs[id].hasKey ? '已配置密钥' : '未配置密钥'}</StatusPill></div><p className="mt-1 text-xs leading-5 text-stone-500">{description}</p></div><span className="service-model">{id}</span></button>)}</div></Panel>
    <Panel><div className="section-label-row"><h2 className="section-label">{services.find((item) => item.id === selected)?.title}</h2><StatusPill tone="neutral"><KeyRound size={13} />密钥不回显</StatusPill></div><div className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="form-field"><span>服务商</span><input value={current.provider} disabled={selected === 'video_parser'} onChange={(event) => update({ provider: event.target.value })} placeholder="例如：OpenAI 兼容服务" /></label>
      {selected !== 'video_parser' && <label className="form-field"><span>模型</span><input value={current.model} onChange={(event) => update({ model: event.target.value })} placeholder="模型名称" /></label>}
      <label className="form-field md:col-span-2"><span>API 地址</span><input type="url" value={current.endpoint} onChange={(event) => update({ endpoint: event.target.value })} placeholder="https://…" /></label>
      <label className="form-field md:col-span-2"><span>{selected === 'video_parser' ? 'TikHub API Key' : 'API 密钥'}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={current.hasKey ? '已保存；留空表示不修改' : '输入 API 密钥'} /></label>
      {selected === 'agent' && <label className="flex items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={current.options.webSearchEnabled === true} onChange={(event) => update({ options: { ...current.options, webSearchEnabled: event.target.checked } })} />允许 Agent 联网搜索（还需配置安全的搜索实现）</label>}
      <label className="flex items-center gap-3 text-sm md:col-span-2"><input type="checkbox" checked={current.enabled} onChange={(event) => update({ enabled: event.target.checked })} />启用此服务</label>
    </div><div className="mt-5 flex flex-wrap items-center gap-3"><SoftButton onClick={() => void save()}><Save size={16} />保存</SoftButton><SoftButton variant="secondary" onClick={() => void validate()}>本地校验</SoftButton>{message && <span className="text-sm text-stone-600">{message}</span>}</div></Panel>
  </div>
}
