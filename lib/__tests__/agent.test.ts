import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  AGENT_ASSET_SELECTION_NOTICE,
  buildAgentPrompt,
  inferAgentTaskType,
  isAgentTaskType,
  normalizeAgentAssetSelection,
  prohibitedAgentCapability,
} from '@/lib/agent'

describe('agent capability and prompt boundaries', () => {
  it('accepts only the six text task types', () => {
    expect(isAgentTaskType('topic-plan')).toBe(true)
    expect(isAgentTaskType('stt')).toBe(false)
    expect(isAgentTaskType('image-generation')).toBe(false)
  })

  it('keeps an explicit instruction free of invented output constraints', () => {
    const instruction = '请把这段介绍改得更自然一些。'
    const prompt = buildAgentPrompt(instruction)
    expect(prompt).toBe(instruction)
    expect(prompt).not.toMatch(/镜头|字幕|时长|字数|格式/)
  })

  it('normalizes confirmed asset IDs and keeps the exact UI notice', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(normalizeAgentAssetSelection({ skillIds: [id, id], profileIds: ['bad'] })).toEqual({
      skillIds: [id], profileIds: [], libraryItemIds: [],
    })
    expect(AGENT_ASSET_SELECTION_NOTICE).toBe('本对话不再弹出选择，直接使用当前已选择资产')
  })

  it('identifies prohibited capabilities and infers a supported text task', () => {
    expect(prohibitedAgentCapability('image-generation')).toBe('image-generation')
    expect(inferAgentTaskType('给我写一条朋友圈')).toBe('moments-copy')
    expect(inferAgentTaskType('帮我做三个春季选题')).toBe('topic-plan')
  })
})
