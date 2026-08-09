import { describe, expect, it } from 'vitest'
import { FEATURE_DEFINITIONS, TEXT_JOB_TYPES, buildPrompt, isTextJobType } from '@/lib/features'

describe('精简文案功能', () => {
  it('只暴露六类文案任务', () => {
    expect(FEATURE_DEFINITIONS.map((feature) => feature.id)).toEqual(TEXT_JOB_TYPES)
    expect(isTextJobType('marketing-poster')).toBe(false)
    expect(isTextJobType('style-test')).toBe(false)
    expect(isTextJobType('video-edit')).toBe(false)
  })

  it('Skill 生效时只整理用户明确提供的输入', () => {
    expect(buildPrompt('moments-copy', { theme: '开业', style: '亲切' }, true)).toBe('theme：开业\nstyle：亲切')
  })

  it('视频转写仿写不追加镜头或字幕格式', () => {
    const prompt = buildPrompt('stt-rewrite', { input: '原始口播', instruction: '改成温柔但有观点的文案' })
    expect(prompt).toContain('原始口播')
    expect(prompt).toContain('温柔但有观点')
    expect(prompt).not.toMatch(/镜头|字幕|分镜|Markdown/i)
  })
})
