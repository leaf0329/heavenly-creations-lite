export const TEXT_JOB_TYPES = [
  'topic-plan',
  'topics',
  'stt-rewrite',
  'xiaohongshu-copy',
  'moments-copy',
  'sales-script',
] as const

export const JOB_TYPES = [...TEXT_JOB_TYPES, 'stt'] as const

export type TextJobType = (typeof TEXT_JOB_TYPES)[number]
export type JobType = (typeof JOB_TYPES)[number]

export type FormField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  options?: string[]
  placeholder?: string
}

export type FeatureDefinition = {
  id: TextJobType
  label: string
  description: string
  fields: FormField[]
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    id: 'topic-plan',
    label: '美业爆款选题',
    description: '结合门店定位和内容资料，制定可执行的选题计划。',
    fields: [
      { key: 'theme', label: '选题方向', type: 'text', placeholder: '如：25 岁独立女性的眉形选择' },
      { key: 'description', label: '补充要求', type: 'textarea', placeholder: '目标人群、平台、周期和内容目标等' },
    ],
  },
  {
    id: 'topics',
    label: '同城变现脚本',
    description: '生成适合本地获客的短视频口播与拍摄脚本。',
    fields: [
      { key: 'theme', label: '视频主题', type: 'text', placeholder: '如：美业人一天的工作日常' },
      { key: 'duration', label: '时长', type: 'text', placeholder: '如：30 秒、1 分钟、自定义' },
      {
        key: 'style',
        label: '类型',
        type: 'select',
        options: ['同城泛话题型', '人设故事型', '精准人群痛点型', '教知识种草型', '讲观点科普型', '门店卖点营销型', '活动通知型'],
      },
      { key: 'description', label: '补充描述', type: 'textarea', placeholder: '目标人群、需要实现的效果、呈现方式等' },
    ],
  },
  {
    id: 'stt-rewrite',
    label: '百业爆款文案拆解',
    description: '使用视频转写或粘贴原文，完成拆解、仿写和优化。',
    fields: [
      { key: 'input', label: '原始文字', type: 'textarea', placeholder: '粘贴转写结果或需要拆解的原文' },
      { key: 'instruction', label: '拆解或仿写要求', type: 'textarea', placeholder: '如：保留结构，改成适合本门店的真诚口播文案' },
    ],
  },
  {
    id: 'xiaohongshu-copy',
    label: '小红书文案',
    description: '生成有信息量、有温度的种草笔记。',
    fields: [
      { key: 'theme', label: '笔记主题', type: 'text', placeholder: '如：美业新手避坑指南' },
      { key: 'tone', label: '语气', type: 'select', options: ['种草', '科普', '分享', '测评'] },
      { key: 'description', label: '补充要求', type: 'textarea', placeholder: '目标读者、内容重点、禁用表达等' },
    ],
  },
  {
    id: 'moments-copy',
    label: '朋友圈文案',
    description: '生成适合朋友圈沟通和获客的短文案。',
    fields: [
      { key: 'theme', label: '主题', type: 'text', placeholder: '如：三月活动通知' },
      { key: 'style', label: '风格', type: 'select', options: ['专业', '亲切', '促销', '故事'] },
      { key: 'description', label: '补充要求', type: 'textarea', placeholder: '活动信息、客户顾虑、行动引导等' },
    ],
  },
  {
    id: 'sales-script',
    label: '成交话术',
    description: '针对具体场景生成自然、可信的沟通话术。',
    fields: [
      { key: 'theme', label: '需要的话术', type: 'text', placeholder: '如：向犹豫客户介绍雾眉项目' },
      { key: 'style', label: '话术风格', type: 'select', options: ['专业', '亲切', '促销', '故事', '私信引导'] },
      { key: 'description', label: '补充要求', type: 'textarea', placeholder: '沟通场景、客户顾虑、目标等' },
    ],
  },
]

export const LOCAL_TOPIC_PROMPTS: Record<string, string> = {
  同城泛话题型: '生成一个同城泛话题短视频脚本。主题：{theme}。时长：{duration}。开头从长沙城市气质或女性话题切入，跟纹眉无关。全文不讲技术不推卖点，只在最后自然收尾到“所以我开了这家店”。{description}',
  人设故事型: '生成一个人设故事型短视频脚本。主题：{theme}。时长：{duration}。用嘉玲老师真实经历做钩子，选一件事直接开始，不讲道理讲经历。店名只在结尾作为故事落脚点出现，落点在体悟上。{description}',
  精准人群痛点型: '生成一个精准人群痛点型短视频脚本。主题：{theme}。时长：{duration}。开头直击具体痛点，精确到人群、场景和感受。先解释为什么会这样，再带出卖点作为答案。结尾给明确下一步。{description}',
  教知识种草型: '生成一个教知识种草型短视频脚本。主题：{theme}。时长：{duration}。先输出知识价值，从知识盲区切入。卖点在知识讲完之后顺带出现，比重不超过全文三分之一。结尾给入口不给压力。{description}',
  讲观点科普型: '生成一个讲观点科普型短视频脚本。主题：{theme}。时长：{duration}。用反常识或行业真相开场，围绕一个观点展开论证。观点来自经验而非姿态。结尾回到观点本身，不塞门店信息。{description}',
  门店卖点营销型: '生成一个门店卖点营销型短视频脚本。主题：{theme}。时长：{duration}。从体验感受切入，卖点藏在体验描述里。结尾落脚在体验上，不给压力。{description}',
  活动通知型: '生成一个活动通知型短视频脚本。主题：{theme}。时长：{duration}。同步近况，开头直接说明为什么发这条。说清有什么变化、为什么、对客户有什么影响。语气是人在说话而不是公文。结尾开放式。{description}',
}

function presentEntries(values: Record<string, string>): string[] {
  return Object.entries(values).flatMap(([key, value]) => value?.trim() ? [`${key}：${value.trim()}`] : [])
}

export function isTextJobType(value: string): value is TextJobType {
  return (TEXT_JOB_TYPES as readonly string[]).includes(value)
}

export function buildPrompt(type: TextJobType, values: Record<string, string>, customSkill = false): string {
  if (customSkill && type !== 'topic-plan') return presentEntries(values).join('\n')

  const extra = values.description?.trim() ? `补充要求：${values.description.trim()}。` : ''
  switch (type) {
    case 'moments-copy':
      return `生成一条微信朋友圈文案。主题：${values.theme || '美业推广'}。风格：${values.style || '专业'}。要求简短有力、真实自然，能引发客户咨询。${extra}`
    case 'xiaohongshu-copy':
      return `生成一篇小红书文案。主题：${values.theme || '美业分享'}。语气：${values.tone || '种草'}。标题吸引人，正文有干货，结尾自然收束。${extra}`
    case 'topic-plan':
      return `根据用户需求生成可执行的选题计划。主题：${values.theme || '美业'}。${extra}`
    case 'topics': {
      const template = LOCAL_TOPIC_PROMPTS[values.style || '同城泛话题型']
      if (!template) return `生成一个${values.style || '同城泛话题'}短视频脚本。主题：${values.theme || '美业'}。时长：${values.duration || '30 秒'}。${extra}`
      return template
        .replace('{theme}', values.theme || '美业')
        .replace('{duration}', values.duration || '30 秒')
        .replace('{description}', extra)
    }
    case 'sales-script':
      return `生成一套美业成交话术。场景：${values.theme || '客户咨询'}。风格：${values.style || '专业'}。要求口语自然、逐步回应顾虑并给出清晰下一步，不夸大承诺。${extra}`
    case 'stt-rewrite':
      return `对以下原始文字进行拆解或仿写。\n原始文字：\n${values.input || ''}\n\n用户要求：${values.instruction || '分析其结构并生成一版可直接使用的新文案。'}`
  }
}
