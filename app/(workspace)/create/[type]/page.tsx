import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { CreateJobForm } from '../../../../components/create-job-form'
import { PageIntro, SoftButton } from '../../../../components/workspace-ui'
import { FEATURE_DEFINITIONS } from '../../../../lib/features'

export default async function CreateTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  const feature = FEATURE_DEFINITIONS.find((item) => item.id === type)
  if (!feature) notFound()
  return <div className="space-y-7 pb-8"><Link href="/create" className="back-link"><ArrowLeft size={15} />返回创作方式</Link><PageIntro eyebrow="WORKSPACE / CREATE" title={feature.label} description={feature.description} action={<SoftButton href="/agent" variant="secondary"><Sparkles size={16} />交给 Agent</SoftButton>} /><CreateJobForm feature={feature} /></div>
}
