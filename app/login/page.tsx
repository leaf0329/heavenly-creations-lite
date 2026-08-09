'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'

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
      <div className="login-decoration login-decoration-one" aria-hidden="true" />
      <div className="login-decoration login-decoration-two" aria-hidden="true" />
      <section className="login-card">
        <Link href="/" className="login-brand"><span className="workspace-brand-dot" /><span><b>HCLite</b><small>团队文案工作台</small></span></Link>
        <div className="mt-12"><p className="eyebrow">WELCOME BACK</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">回到你的工作台</h1><p className="mt-3 text-sm leading-6 text-stone-500">登录后继续写作、转写和整理团队资料。</p></div>
        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="form-field"><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="输入用户名" required /></label>
          <label className="form-field"><span>密码</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="输入密码" required /></label>
          {error && <p role="alert" className="login-error"><LockKeyhole size={15} />{error}</p>}
          <button type="submit" className="soft-button soft-button-primary w-full justify-center" disabled={busy}>{busy ? '正在登录…' : '登录工作台'}<ArrowRight size={17} /></button>
        </form>
        <div className="login-note"><Sparkles size={15} /><p>这是团队内部工作区，不开放公开注册。需要账号请联系主账户。</p></div>
      </section>
      <p className="login-footer">HC LITE · 只保留写作本身</p>
    </main>
  )
}
