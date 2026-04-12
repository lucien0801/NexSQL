import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FontSize = 'small' | 'medium' | 'large'
export type Theme = 'dark' | 'light' | 'light-blue'

interface PrefsState {
  fontSize: FontSize
  theme: Theme
  setFontSize: (size: FontSize) => void
  setTheme: (theme: Theme) => void
}

const fontSizeCssVars: Record<FontSize, string> = {
  small: '12px',
  medium: '14px',
  large: '16px'
}

export function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty('--app-font-size', fontSizeCssVars[size])
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.remove('theme-dark', 'theme-light', 'theme-light-blue')
  if (theme === 'light') {
    document.documentElement.classList.add('theme-light')
    return
  }
  if (theme === 'light-blue') {
    document.documentElement.classList.add('theme-light-blue')
    return
  }
  document.documentElement.classList.add('theme-dark')
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      fontSize: 'medium',
      theme: 'dark',
      setFontSize: (size) => {
        applyFontSize(size)
        set({ fontSize: size })
      },
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      }
    }),
    { name: 'nexsql-prefs' }
  )
)
