import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  detectPlatform,
  extractDouyinMediaUrl,
  extractBvid,
  extractToutiaoGroupId,
  extractTikHubMediaUrl,
  extractWeiboMid,
  extractXiguaItemId,
  resolveTikHubMedia,
  SUPPORTED_VIDEO_PLATFORMS,
} from '../video-parser'

describe('domestic video share URL platform detection', () => {
  it.each([
    ['https://v.douyin.com/example/', 'douyin'],
    ['https://www.bilibili.com/video/BV1xx', 'bilibili'],
    ['https://xhslink.com/abc', 'xiaohongshu'],
    ['https://www.kuaishou.com/short-video/abc', 'kuaishou'],
    ['https://www.ixigua.com/123', 'toutiao'],
    ['https://channels.weixin.qq.com/example', 'weixin'],
    ['https://weibo.com/tv/show/abc', 'weibo'],
    ['https://www.youtube.com/watch?v=abc', 'unknown'],
    ['https://www.tiktok.com/t/example', 'unknown'],
    ['https://example.com/video.mp4', 'unknown'],
  ])('%s => %s', (url, expected) => {
    expect(detectPlatform(url)).toBe(expected)
  })

  it('exposes exactly the approved seven domestic platforms', () => {
    expect(SUPPORTED_VIDEO_PLATFORMS).toEqual([
      'douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'toutiao', 'weixin', 'weibo',
    ])
  })
})

describe('TikHub explicit response adapters', () => {
  it('prefers Douyin H.264 media instead of cover or HEVC', () => {
    expect(extractDouyinMediaUrl({
      data: { aweme_detail: { video: {
        cover: { url_list: ['https://cdn.example/cover.jpg'] },
        play_addr_h264: { url_list: ['https://cdn.example/video-h264.mp4'] },
        play_addr_265: { url_list: ['https://cdn.example/video-hevc.mp4'] },
      } } },
    })).toBe('https://cdn.example/video-h264.mp4')
  })

  it.each([
    ['bilibili', { data: { data: { dash: { audio: [{ baseUrl: 'https://cdn.example/bili-audio.m4s' }] } } } }, 'https://cdn.example/bili-audio.m4s'],
    ['xiaohongshu', { data: { data: { video: { media: { stream: { h264: [{ master_url: 'https://cdn.example/xhs.mp4' }] } } } } } }, 'https://cdn.example/xhs.mp4'],
    ['kuaishou', { data: { data: { video: { urls: ['https://cdn.example/kuaishou.mp4'] } } } }, 'https://cdn.example/kuaishou.mp4'],
    ['toutiao', { data: { data: { video_info: { video_url: 'https://cdn.example/toutiao.mp4' } } } }, 'https://cdn.example/toutiao.mp4'],
    ['weixin', { data: { media: { full_url: 'https://cdn.example/weixin.mp4', decode_key: '123' } } }, 'https://cdn.example/weixin.mp4'],
    ['weibo', { data: { data: { page_info: { media_info: { stream_url_hd: 'https://cdn.example/weibo.mp4' } } } } }, 'https://cdn.example/weibo.mp4'],
  ])('extracts %s media from its documented field', (platform, payload, expected) => {
    expect(extractTikHubMediaUrl(platform, payload)).toBe(expected)
  })

  it('extracts platform IDs without sending source pages to TikHub', () => {
    expect(extractBvid('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD')
    expect(extractXiguaItemId('https://www.ixigua.com/7280432455770173989/')).toBe('7280432455770173989')
    expect(extractToutiaoGroupId('https://www.toutiao.com/video/7280432455770173989/')).toBe('7280432455770173989')
    expect(extractWeiboMid('https://weibo.com/tv/show/1034:5232127105761312')).toBe('5232127105761312')
  })

  it('does not recursively mistake a cover URL for video media', () => {
    expect(extractTikHubMediaUrl('xiaohongshu', {
      data: { items: [{ note_card: { cover: { url: 'https://cdn.example/cover.jpg' } } }] },
    })).toBeNull()
  })
})

describe('TikHub request behavior', () => {
  const input = {
    sourceUrl: 'https://v.douyin.com/example/',
    platform: 'douyin' as const,
    endpoint: new URL('https://api.tikhub.dev'),
    apiKey: 'secret-test-key',
    options: {},
  }

  it('falls back from Douyin Web to App V3 when Web has no media', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { aweme_detail: { video: { play_addr: { url_list: ['https://cdn.example/douyin.mp4'] } } } },
      }), { status: 200 }))

    const result = await resolveTikHubMedia(input, fetcher)

    expect(result.mediaUrl).toBe('https://cdn.example/douyin.mp4')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/douyin/web/fetch_one_video_by_share_url')
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/douyin/app/v3/fetch_one_video_by_share_url')
    expect(fetcher.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer secret-test-key')
  })

  it('maps TikHub credential and visibility failures', async () => {
    const unauthorized = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    await expect(resolveTikHubMedia(input, unauthorized)).rejects.toThrow('API Key 无效或已过期')

    const privateVideo = vi.fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { filter_list: [{ reason: 5 }] } }), { status: 200 })))
    await expect(resolveTikHubMedia(input, privateVideo)).rejects.toThrow('私密作品')
  })

  it('uses current Xiaohongshu one-step endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, data: { data: { video: { media: { stream: { h264: [{ master_url: 'https://cdn.example/xhs.mp4' }] } } } } },
    }), { status: 200 }))
    await resolveTikHubMedia({ ...input, platform: 'xiaohongshu', sourceUrl: 'https://xhslink.com/abc' }, fetcher)
    const requested = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe('/api/v1/xiaohongshu/app_v2/get_video_note_detail')
    expect(requested.searchParams.get('share_text')).toBe('https://xhslink.com/abc')
  })

  it('gets Bilibili CID then selects the DASH audio track', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { data: [{ cid: 456 }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200, data: { data: { dash: { audio: [{ baseUrl: 'https://cdn.example/audio.m4s' }] } } },
      }), { status: 200 }))
    const result = await resolveTikHubMedia({
      ...input, platform: 'bilibili', sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    }, fetcher)
    expect(result.mediaUrl).toBe('https://cdn.example/audio.m4s')
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/api/v1/bilibili/web/fetch_video_parts')
    expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('cid')).toBe('456')
  })

  it('posts the WeChat share URL and retains the matching decode key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, data: { media: { url: 'https://cdn.example/video.mp4?', url_token: 'token=abc', decode_key: 2136343393 } },
    }), { status: 200 }))
    const result = await resolveTikHubMedia({
      ...input, platform: 'weixin', sourceUrl: 'https://channels.weixin.qq.com/example',
    }, fetcher)
    expect(result).toMatchObject({ mediaUrl: 'https://cdn.example/video.mp4?token=abc', decodeKey: '2136343393' })
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ share_url: 'https://channels.weixin.qq.com/example', raw: false }),
    })
  })

  it.each([
    ['https://www.ixigua.com/7280432455770173989/', '/api/v1/xigua/app/v2/fetch_one_video_play_url', 'item_id'],
    ['https://www.toutiao.com/video/7280432455770173989/', '/api/v1/toutiao/app/get_video_info', 'group_id'],
    ['https://weibo.com/tv/show/1034:5232127105761312', '/api/v1/weibo/app/fetch_video_detail', 'mid'],
  ])('uses a current ID-based endpoint for %s', async (sourceUrl, pathname, parameter) => {
    const platform = sourceUrl.includes('weibo') ? 'weibo' : 'toutiao'
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(platform === 'weibo'
      ? { code: 200, data: { data: { page_info: { media_info: { stream_url_hd: 'https://cdn.example/media.mp4' } } } } }
      : sourceUrl.includes('ixigua') ? { code: 200, data: { data: { video_url: 'https://cdn.example/media.mp4' } } }
      : { code: 200, data: { data: { video_info: { video_url: 'https://cdn.example/media.mp4' } } } }), { status: 200 }))
    await resolveTikHubMedia({ ...input, platform, sourceUrl }, fetcher)
    const requested = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe(pathname)
    expect(requested.searchParams.get(parameter)).toBeTruthy()
  })
})
