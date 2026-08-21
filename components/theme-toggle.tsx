'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { THEME_STORAGE_KEY } from '@/lib/theme'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), [])
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    document.documentElement.style.colorScheme = next ? 'dark' : 'light'
    localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light')
    setDark(next)
  }
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={dark ? '切换浅色模式' : '切换深色模式'}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
}
