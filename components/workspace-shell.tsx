'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Bot,
  FileText,
  History,
  Home,
  Library,
  LogOut,
  Menu,
  Mic2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { AuthProvider, useAuth } from './auth-context'
import BrandIdentity, { BrandMark } from './brand-identity'
import { ThemeToggle } from './theme-toggle'

type NavItem = {
  href: string
  label: string
  icon: typeof Home
  ownerOnly?: boolean
}

const primaryItems: NavItem[] = [
  { href: '/', label: '首页', icon: Home },
  { href: '/agent', label: '文案 Agent', icon: Bot },
  { href: '/create', label: '文案创作', icon: FileText },
  { href: '/transcribe', label: '视频转文字', icon: Mic2 },
]

const resourceItems: NavItem[] = [
  { href: '/history', label: '历史记录', icon: History },
  { href: '/skills', label: 'Skill', icon: Sparkles },
  { href: '/profiles', label: '门店档案', icon: UserRound },
  { href: '/library', label: '团队资料库', icon: Library },
]

const accountItems: NavItem[] = [
  { href: '/account', label: '账号设置', icon: Settings2 },
  { href: '/admin/users', label: '用户管理', icon: UsersRound, ownerOnly: true },
  { href: '/admin/api', label: 'API 配置', icon: ShieldCheck, ownerOnly: true },
]

function isCurrentPath(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const pathname = usePathname()
  const active = isCurrentPath(pathname, item.href)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`workspace-nav-link ${active ? 'workspace-nav-link-active' : ''} ${compact ? 'workspace-nav-link-compact' : ''}`}
    >
      <Icon size={compact ? 19 : 18} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  )
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const { user, isOwner } = useAuth()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const ownerItems = accountItems.filter((item) => !item.ownerOnly || isOwner)
  const closeMobileMenu = () => setMobileMenuOpen(false)
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <div className="workspace-app">
      <aside className={`workspace-sidebar ${collapsed ? 'workspace-sidebar-collapsed' : ''}`}>
        <div className="workspace-brand">
          <Link href="/" className="workspace-brand-mark" aria-label="回到美咖自媒体首页"><BrandMark /></Link>
          {!collapsed && (
            <div className="min-w-0">
              <p className="workspace-brand-title">美咖自媒体</p>
              <p className="workspace-brand-subtitle">MEIKAAI · 内容工作台</p>
            </div>
          )}
          <button
            type="button"
            className="workspace-sidebar-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="workspace-sidebar-nav" aria-label="主导航">
          <p className="workspace-nav-caption">工作台</p>
          {primaryItems.map((item) => <NavLink key={item.href} item={item} />)}
          <p className="workspace-nav-caption workspace-nav-caption-spaced">资料与历史</p>
          {resourceItems.map((item) => <NavLink key={item.href} item={item} />)}
          <p className="workspace-nav-caption workspace-nav-caption-spaced">账号</p>
          {ownerItems.map((item) => <NavLink key={item.href} item={item} />)}
        </nav>

        <div className="workspace-sidebar-footer">
          <div className="workspace-user-card">
            <span className="workspace-avatar">{(user?.displayName || user?.username || '访').slice(0, 1)}</span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{user?.displayName || user?.username || '本地工作区'}</p>
                <p className="truncate text-xs text-stone-500">{isOwner ? '主账户' : '团队成员'}</p>
              </div>
            )}
          </div>
          {!collapsed && <ThemeToggle />}
          <button type="button" className="workspace-logout" onClick={handleLogout} title="退出登录">
            <LogOut size={17} />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>
      </aside>

      <header className="workspace-mobile-header">
        <Link href="/" className="workspace-mobile-brand" aria-label="回到首页"><BrandIdentity compact /></Link>
        <div className="workspace-mobile-actions"><ThemeToggle /><button type="button" className="workspace-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="打开导航"><Menu size={22} /></button></div>
      </header>

      {mobileMenuOpen && (
        <div className="workspace-mobile-drawer-wrap" role="dialog" aria-modal="true" aria-label="导航菜单">
          <button type="button" className="workspace-mobile-scrim" onClick={closeMobileMenu} aria-label="关闭导航" />
          <aside className="workspace-mobile-drawer">
            <div className="flex items-center justify-between">
              <div className="workspace-mobile-brand"><BrandIdentity compact /></div>
              <button type="button" className="workspace-menu-button" onClick={closeMobileMenu} aria-label="关闭导航"><X size={21} /></button>
            </div>
            <nav className="mt-7 space-y-1" onClick={closeMobileMenu}>
              <p className="workspace-nav-caption">工作台</p>
              {primaryItems.map((item) => <NavLink key={item.href} item={item} />)}
              <p className="workspace-nav-caption workspace-nav-caption-spaced">资料与历史</p>
              {resourceItems.map((item) => <NavLink key={item.href} item={item} />)}
              <p className="workspace-nav-caption workspace-nav-caption-spaced">账号</p>
              {ownerItems.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </aside>
        </div>
      )}

      <main className="workspace-main">
        <div className="workspace-content">{children}</div>
      </main>

      <nav className="workspace-bottom-nav" aria-label="移动端导航">
        {primaryItems.slice(0, 4).map((item) => <NavLink key={item.href} item={item} compact />)}
        <Link href="/library" className={`workspace-nav-link workspace-nav-link-compact ${isCurrentPath(pathname, '/library') ? 'workspace-nav-link-active' : ''}`}>
          <BookOpen size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>资料</span>
        </Link>
      </nav>
      <div className="workspace-mobile-safe-area" aria-hidden="true" />
    </div>
  )
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ShellContent>{children}</ShellContent></AuthProvider>
}
