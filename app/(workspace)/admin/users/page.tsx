import { ShieldCheck } from 'lucide-react'
import { OwnerOnly } from '../../../../components/auth-context'
import { AdminUsersClient } from '../../../../components/admin-users-client'
import { EmptyState, PageIntro, Panel } from '../../../../components/workspace-ui'

export default function AdminUsersPage() {
  return <OwnerOnly fallback={<div className="space-y-7 pb-8"><PageIntro eyebrow="管理 / USERS" title="用户管理" description="这是主账户专属的团队管理页面。" /><Panel><EmptyState icon={ShieldCheck} title="需要主账户权限" description="请使用主账户登录后再访问用户管理。" /></Panel></div>}><AdminUsersClient /></OwnerOnly>
}
