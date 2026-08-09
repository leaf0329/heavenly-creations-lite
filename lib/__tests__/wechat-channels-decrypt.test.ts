import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { generateWeChatKeystream } from '../wechat-channels-decrypt'

describe('WeChat Channels official WASM adapter', () => {
  it('generates the verified reversed 128KB keystream', async () => {
    const stream = await generateWeChatKeystream('2136343393')
    expect(stream).toHaveLength(131_072)
    expect(stream.subarray(0, 16).toString('hex')).toBe('23766a3699fb876a75d5a232994844ab')
    expect(createHash('sha256').update(stream).digest('hex'))
      .toBe('49b96d6fc75ba5215fbb773ce98f6b20f6441a7ac40abc9582b1e42c5f3cd9d8')
  })
})
