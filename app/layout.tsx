import type { Metadata, Viewport } from 'next'
import './globals.css'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'

export const metadata: Metadata = {
  title: '美咖自媒体 · MeikaAI 内容工作台',
  applicationName: '美咖自媒体',
  description: '团队内部使用的文案创作与视频转文字工具',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/brand-mark.svg', type: 'image/svg+xml' }],
    apple: '/brand/icon-180.png',
  },
  appleWebApp: {
    capable: true,
    title: '美咖自媒体',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eee8dc' },
    { media: '(prefers-color-scheme: dark)', color: '#151512' },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  )
}
