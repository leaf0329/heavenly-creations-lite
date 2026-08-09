import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { detectPlatform } from '../video-parser'

describe('video share URL platform detection', () => {
  it.each([
    ['https://v.douyin.com/example/', 'douyin'],
    ['https://www.bilibili.com/video/BV1xx', 'bilibili'],
    ['https://xhslink.com/abc', 'xiaohongshu'],
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://example.com/video.mp4', 'unknown'],
  ])('%s => %s', (url, expected) => {
    expect(detectPlatform(url)).toBe(expected)
  })
})
