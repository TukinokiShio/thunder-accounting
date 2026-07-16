/**
 * 语言 Context —— 提供当前语言及翻译函数 t()。
 * 用法：
 *   const { t, language, setLanguage } = useLanguage()
 *   <span>{t('设置')}</span>
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { T } from './translations'
import { loadSettings, saveSettings } from '@/utils/settings'

interface LanguageContextValue {
  language: 'zh' | 'en'
  /** 翻译函数：传入中文原文，返回当前语言的文本。未知 key 返回原文。 */
  t: (key: string) => string
  setLanguage: (lang: 'zh' | 'en') => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<'zh' | 'en'>(() => loadSettings().language)

  const setLanguage = useCallback((lang: 'zh' | 'en') => {
    setLanguageState(lang)
    saveSettings({ language: lang })
  }, [])

  const t = useCallback(
    (key: string): string => {
      if (language === 'zh') return key
      // 处理带占位符的模板字符串，如 '已记录{label}：{cat} ¥{amount}'
      // 调用方用 t('已记录{label}：{cat} ¥{amount}').replace('{label}', ...) 自行替换
      return T[key] ?? key
    },
    [language]
  )

  const value = useMemo(() => ({ language, t, setLanguage }), [language, t, setLanguage])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    // 降级模式：没有 LanguageProvider 时（如测试环境），默认返回中文
    return { language: 'zh', t: (key: string) => key, setLanguage: () => {} }
  }
  return ctx
}
