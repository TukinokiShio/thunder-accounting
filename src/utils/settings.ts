/**
 * 应用偏好设置的 localStorage 持久化层。
 * 键名：thunder_settings，存储 JSON 对象 { timezone: string, language: 'zh' | 'en' }。
 */

export interface AppSettings {
  timezone: string // IANA 时区标识符，如 'Asia/Shanghai'
  language: 'zh' | 'en'
}

/** 时区选项（显示名 → IANA 标识符的映射） */
export const TIMEZONE_OPTIONS: { label: string; value: string }[] = [
  { label: '北京时间 (UTC+8)', value: 'Asia/Shanghai' },
  { label: '东京时间 (UTC+9)', value: 'Asia/Tokyo' },
  { label: '首尔时间 (UTC+9)', value: 'Asia/Seoul' },
  { label: '新加坡时间 (UTC+8)', value: 'Asia/Singapore' },
  { label: '伦敦时间 (UTC+0)', value: 'Europe/London' },
  { label: '巴黎时间 (UTC+1)', value: 'Europe/Paris' },
  { label: '纽约时间 (UTC-5)', value: 'America/New_York' },
  { label: '洛杉矶时间 (UTC-8)', value: 'America/Los_Angeles' }
]

const STORAGE_KEY = 'thunder_settings'

const DEFAULT_SETTINGS: AppSettings = {
  timezone: 'Asia/Shanghai',
  language: 'zh'
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    // 合并默认值，处理旧版本缺少字段的情况
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  return merged
}
