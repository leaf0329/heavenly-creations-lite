'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type AccountType = 'owner' | 'member'

export type CurrentUser = {
  id?: string
  username?: string
  displayName?: string
  accountType?: AccountType | string
  status?: string
}

type AuthContextValue = {
  user: CurrentUser | null
  loading: boolean
  isOwner: boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readUser(payload: unknown): CurrentUser | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { user?: unknown }
  const candidate = value.user && typeof value.user === 'object' ? value.user : payload
  if (!candidate || typeof candidate !== 'object') return null
  return candidate as CurrentUser
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) {
        setUser(null)
        if (response.status === 401 && window.location.pathname !== '/login') {
          window.location.replace('/login')
        }
        return
      }
      const payload: unknown = await response.json()
      setUser(readUser(payload))
    } catch {
      // The shell remains usable as a static preview when the API is not running.
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value = useMemo(
    () => ({ user, loading, isOwner: user?.accountType === 'owner', refresh }),
    [loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export function OwnerOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isOwner, loading } = useAuth()
  if (loading) return <div className="h-24 animate-pulse rounded-3xl bg-white/60" aria-label="正在检查权限" />
  if (!isOwner) {
    return (
      fallback ?? (
        <div className="empty-state">
          <p className="text-sm font-semibold text-ink">这个页面仅限主账户使用</p>
          <p className="mt-2 text-sm text-stone-500">如果你需要访问管理功能，请联系主账户。</p>
        </div>
      )
    )
  }
  return <>{children}</>
}
