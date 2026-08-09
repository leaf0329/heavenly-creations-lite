import Link from 'next/link'
import { ArrowUpRight, Bot, FileText, Library, Mic2, Sparkles } from 'lucide-react'
import { Panel, SectionLabel, SoftButton, StatusPill } from './workspace-ui'

const shortcuts = [
  {
    href: '/agent',
    title: '文案 Agent',
    description: '把一个想法交给 Agent，一起整理成可发布的内容。',
    icon: Bot,
    tone: 'rose',
  },
  {
    href: '/create',
    title: '文案创作',
    description: '从六种常用创作模板开始，快速得到第一版。',
    icon: FileText,
    tone: 'sand',
  },
  {
    href: '/transcribe',
    title: '视频转文字',
    description: '上传视频或粘贴链接，再继续拆解、仿写和优化。',
    icon: Mic2,
    tone: 'plum',
  },
]

export function HomeDashboard() {
  return (
    <div className="space-y-10 pb-8">
      <section className="dashboard-hero">
        <div className="relative z-10 max-w-2xl">
          <p className="eyebrow">HCLITE / WORKSPACE</p>
          <h1 className="dashboard-title">把日常灵感，<br className="hidden sm:block" />放进一个安静的工作台。</h1>
          <p className="dashboard-copy">这里聚合团队的文案 Agent、常用创作方式和视频转文字。先从一个小想法开始，剩下的交给工作台。</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <SoftButton href="/agent"><Bot size={17} />开始和 Agent 对话</SoftButton>
            <SoftButton href="/create" variant="secondary">浏览创作方式 <ArrowUpRight size={16} /></SoftButton>
          </div>
        </div>
        <div className="dashboard-hero-orbit" aria-hidden="true">
          <span className="dashboard-orbit-ring dashboard-orbit-ring-large" />
          <span className="dashboard-orbit-ring dashboard-orbit-ring-small" />
          <span className="dashboard-orbit-dot dashboard-orbit-dot-one" />
          <span className="dashboard-orbit-dot dashboard-orbit-dot-two" />
          <span className="dashboard-orbit-card dashboard-orbit-card-top">今天写点什么？</span>
          <span className="dashboard-orbit-card dashboard-orbit-card-bottom"><Sparkles size={14} />有灵感就记下来</span>
        </div>
      </section>

      <section>
        <SectionLabel>从这里开始</SectionLabel>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {shortcuts.map(({ href, title, description, icon: Icon, tone }) => (
            <Link key={href} href={href} className="shortcut-card group">
              <span className={`shortcut-icon shortcut-icon-${tone}`}><Icon size={22} strokeWidth={1.8} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink">{title}</h3>
                  <ArrowUpRight size={17} className="shrink-0 text-stone-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-rose" />
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-500">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel>
          <SectionLabel href="/history">最近活动</SectionLabel>
          <div className="mt-5">
            <div className="activity-empty">
              <span className="activity-empty-icon"><FileText size={19} /></span>
              <div>
                <p className="text-sm font-medium text-ink">你的第一份内容会出现在这里</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">完成一次创作或转写后，可以在历史记录里继续优化。</p>
              </div>
              <StatusPill>暂无记录</StatusPill>
            </div>
          </div>
        </Panel>
        <Panel>
          <SectionLabel>工作台资料</SectionLabel>
          <div className="mt-4 space-y-2">
            <Link href="/skills" className="resource-row"><span className="resource-row-icon resource-row-icon-rose"><Sparkles size={16} /></span><span><b>Skill</b><small>让 Agent 更懂你的方法</small></span><ArrowUpRight size={15} /></Link>
            <Link href="/profiles" className="resource-row"><span className="resource-row-icon resource-row-icon-sand"><FileText size={16} /></span><span><b>门店档案</b><small>保存门店定位与服务信息</small></span><ArrowUpRight size={15} /></Link>
            <Link href="/library" className="resource-row"><span className="resource-row-icon resource-row-icon-plum"><Library size={16} /></span><span><b>团队资料库</b><small>和团队共享有用的素材</small></span><ArrowUpRight size={15} /></Link>
          </div>
        </Panel>
      </div>
    </div>
  )
}
