/**
 * 时区感知的日期工具函数。
 * 使用 Intl.DateTimeFormat 按指定 IANA 时区格式化日期，不依赖外部库。
 */

import { loadSettings } from './settings'

/**
 * 按用户选择的时区返回 YYYY-MM-DD 格式的本地日期。
 * 默认从 localStorage 读取时区设置，也可显式传入。
 */
export function formatLocalDate(date: Date = new Date(), timezone?: string): string {
  const tz = timezone || loadSettings().timezone

  // Intl.DateTimeFormat 按指定时区格式化
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }

  return `${map.year}-${map.month}-${map.day}`
}
