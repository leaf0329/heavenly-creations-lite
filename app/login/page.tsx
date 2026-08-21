'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import BrandIdentity from '@/components/brand-identity'
import { TypewriterText } from '@/components/typewriter-text'

const LOGIN_STORY = '把门店的好服务，\n变成持续被看见的内容。'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null
        setError(payload?.error || payload?.message || '用户名或密码不正确，请重试。')
        return
      }
      window.location.href = '/'
    } catch {
      setError('暂时无法连接到本地服务，请确认服务已启动。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="美咖自媒体内容工作台">
        <BrandIdentity />
        <div className="login-visual-copy"><p className="eyebrow">美业内容工作台</p><h1><TypewriterText text={LOGIN_STORY} /></h1><p>选题、文案、视频转文字与团队资料集中在一处，让每位伙伴都能顺畅完成日常创作。</p></div>
        <div className="login-visual-foot"><ShieldCheck size={16} />团队专属空间 · 内容与品牌资料统一管理</div>
      </section>
      <section className="login-form-side">
      <div className="login-mobile-lockup"><BrandIdentity /></div>
      <section className="login-card">
        <Link href="/" className="login-brand"><BrandIdentity /></Link>
        <div className="mt-12 login-heading"><p>欢迎回来</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">登录美咖</h1><p className="mt-3 text-sm leading-6 text-stone-500">继续处理今天的创作任务。</p></div>
        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="form-field"><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="输入用户名" required /></label>
          <label className="form-field"><span>密码</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="输入密码" required /></label>
          {error && <p role="alert" className="login-error"><LockKeyhole size={15} />{error}</p>}
          <button type="submit" className="soft-button soft-button-primary w-full justify-center" disabled={busy}>{busy ? '正在登录…' : '登录工作台'}<ArrowRight size={17} /></button>
        </form>
        <div className="login-note"><ShieldCheck size={15} /><p>这是团队内部工作区，不开放公开注册。需要账号请联系主账户。</p></div>
      </section>
      <p className="login-footer">美咖自媒体 · MEIKAAI CONTENT WORKSPACE</p>
      </section>
    </main>
  )
}
