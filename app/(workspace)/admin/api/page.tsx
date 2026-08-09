import { ShieldCheck } from 'lucide-react'
import { OwnerOnly } from '../../../../components/auth-context'
import { ApiConfigClient } from '../../../../components/api-config-client'
import { PageIntro, Panel } from '../../../../components/workspace-ui'

export default function AdminApiPage() {
  return <OwnerOnly fallback={<div className="space-y-7 pb-8"><PageIntro eyebrow="管理 / API" title="API 配置" description="这是主账户专属的共享服务配置页面。" /><Panel><div className="empty-state"><span className="empty-state-icon"><ShieldCheck size={22} /></span><h2 className="mt-4 text-base font-semibold text-ink">需要主账户权限</h2><p className="mt-2 max-w-sm text-sm leading-6 text-stone-500">请使用主账户登录后再访问 API 配置。</p></div></Panel></div>}><ApiConfigClient /></OwnerOnly>
}
