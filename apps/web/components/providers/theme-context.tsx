"use client"
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
  // next-themes compatibility
  theme: string
  resolvedTheme: string
  setTheme: (t: string) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = "stacksai-theme"

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    let initial: boolean
    if (saved === "dark" || saved === "light") {
      initial = saved === "dark"
    } else {
      initial = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    if (initial !== isDark) setIsDark(initial)
    if (initial) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setIsDark(e.matches)
        document.documentElement.classList.toggle('dark', e.matches)
      }
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light")
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }

  const setTheme = (t: string) => {
    const wantsDark = t === 'dark'
    if (wantsDark !== isDark) toggleTheme()
  }

  return (
    <ThemeContext.Provider value={{
      isDark,
      toggleTheme,
      theme: isDark ? 'dark' : 'light',
      resolvedTheme: isDark ? 'dark' : 'light',
      setTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
