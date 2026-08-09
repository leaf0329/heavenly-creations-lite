import Link from 'next/link'
import { ArrowUpRight, BookOpenText, MessageCircleMore, PenLine, Radar, Scissors, Target } from 'lucide-react'
import { PageIntro, Panel, SectionLabel } from '../../../components/workspace-ui'

const creationTypes = [
  { slug: 'topics', title: '美业爆款选题', description: '从服务、季节和客户困惑里找到值得写的主题。', icon: Radar, tone: 'rose', detail: '选题规划' },
  { slug: 'sales-script', title: '同城变现脚本', description: '把一个本地生意场景，写成有节奏的短视频脚本。', icon: Target, tone: 'sand', detail: '脚本创作' },
  { slug: 'stt-rewrite', title: '百业爆款文案拆解', description: '贴入原文或先转写，再拆解结构并生成仿写方向。', icon: Scissors, tone: 'plum', detail: '拆解与仿写' },
  { slug: 'xiaohongshu-copy', title: '小红书文案', description: '为一张照片、一项服务或一个想法写出自然的分享。', icon: BookOpenText, tone: 'rose', detail: '图文内容' },
  { slug: 'moments-copy', title: '朋友圈文案', description: '轻一点、真一点，写出适合日常发布的短文案。', icon: MessageCircleMore, tone: 'sand', detail: '日常发布' },
  { slug: 'sales-copy', title: '成交话术', description: '围绕客户顾虑，整理一段可以直接使用的沟通话术。', icon: PenLine, tone: 'plum', detail: '沟通转化' },
]

export default function CreatePage() {
  return (
    <div className="space-y-8 pb-8">
      <PageIntro eyebrow="WORKSPACE / CREATE" title="文案创作" description="六种常用创作方式，选一个最接近你此刻的任务。" />
      <section>
        <SectionLabel>选择创作方式</SectionLabel>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {creationTypes.map(({ slug, title, description, icon: Icon, tone, detail }) => (
            <Link href={`/create/${slug}`} key={slug} className="creation-card group">
              <div className="flex items-start justify-between gap-4"><span className={`shortcut-icon shortcut-icon-${tone}`}><Icon size={21} strokeWidth={1.8} /></span><ArrowUpRight size={18} className="text-stone-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-rose" /></div>
              <p className="mt-5 text-xs font-medium tracking-wide text-rose">{detail}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">{description}</p>
              <span className="creation-card-link">开始创作 <ArrowUpRight size={14} /></span>
            </Link>
          ))}
        </div>
      </section>
      <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold text-ink">不确定从哪里开始？</p><p className="mt-1 text-sm text-stone-500">让 Agent 先帮你梳理需求，再决定使用哪种方式。</p></div>
        <Link href="/agent" className="section-link shrink-0">去问 Agent <ArrowUpRight size={15} /></Link>
      </Panel>
    </div>
  )
}
