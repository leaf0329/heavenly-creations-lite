import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HCLite 文案工作台',
  description: '团队内部使用的文案创作与视频转文字工具',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
