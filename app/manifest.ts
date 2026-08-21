import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '美咖自媒体 · MeikaAI 内容工作台',
    short_name: '美咖自媒体',
    description: '团队内部使用的文案创作与视频转文字工具',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    background_color: '#eee8dc',
    theme_color: '#9f493d',
    lang: 'zh-CN',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
