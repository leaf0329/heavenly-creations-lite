import Link from 'next/link'
import { ArrowUpRight, Check, Clipboard, Clock3, FileText, Plus, Sparkles } from 'lucide-react'

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-intro">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="page-intro-action">{action}</div>}
    </header>
  )
}

export function SoftButton({ href, children, onClick, variant = 'primary', type = 'button' }: {
  href?: string
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'
}) {
  const className = `soft-button soft-button-${variant}`
  if (href) return <Link href={href} className={className}>{children}</Link>
  return <button type={type} onClick={onClick} className={className}>{children}</button>
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function EmptyState({ icon: Icon = FileText, title, description, action }: {
  icon?: typeof FileText
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon size={22} strokeWidth={1.8} /></span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'working' }) {
  return <span className={`status-pill status-pill-${tone}`}>{tone === 'success' && <Check size={13} />}{tone === 'working' && <Clock3 size={13} />}{children}</span>
}

export function CopyButton({ label = '复制结果' }: { label?: string }) {
  return <button type="button" className="inline-action"><Clipboard size={15} />{label}</button>
}

export function SectionLabel({ children, href }: { children: React.ReactNode; href?: string }) {
  return (
    <div className="section-label-row">
      <h2 className="section-label">{children}</h2>
      {href && <Link href={href} className="section-link">查看全部 <ArrowUpRight size={14} /></Link>}
    </div>
  )
}

export function AddButton({ href, label = '新建' }: { href?: string; label?: string }) {
  return <SoftButton href={href} variant="secondary"><Plus size={16} />{label}</SoftButton>
}

export function PromptTextarea({ placeholder }: { placeholder: string }) {
  return <textarea className="prompt-textarea" placeholder={placeholder} rows={5} />
}

export function SelectionChip({ children, selected = false }: { children: React.ReactNode; selected?: boolean }) {
  return <button type="button" className={`selection-chip ${selected ? 'selection-chip-selected' : ''}`}>{selected && <Check size={14} />}{children}</button>
}

export function ComingSoonTag() {
  return <span className="status-pill status-pill-neutral"><Sparkles size={13} />准备中</span>
}
