/**
 * 周期推进与到期判定（v2.0 周期支出）。
 *
 * 纯函数、无副作用、不依赖平台 —— 供周期支出页 / 记一笔弹窗 / 单测共用。
 * 月/年周期使用「锚日对齐」：以登记日（规则首次 next_date）的日号为锚，
 * 目标月无该日则取月末，且推进基准永远是上一期的 next_date ——
 * 避免「1 月 31 日 → 2 月 28 日 → 3 月 28 日」的锚漂移。
 */

import { nextTradingDay } from '@/data/tradingCalendar'

export type CycleUnit = 'day' | 'week' | 'month' | 'year'

/** 解析 YYYY-MM-DD 为本地日期分量（不做时区换算，账单日期一律按本地日历语义） */
export function parseLocalDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y: y || 1970, m: m || 1, d: d || 1 }
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/**
 * 从 date 推进 interval 个周期单位，返回下一期日期。
 *
 * - day/week：纯加法（锚日不参与）。
 * - month：目标月 = 月 + interval×n；日 = min(anchorDay, 目标月天数)。
 * - year：目标年 = 年 + interval；日 = min(anchorDay, 目标月天数)（锚日只对齐「日号」，月份沿用基准日期）。
 *
 * @param date      推进基准（上一期 next_date）
 * @param unit      周期单位
 * @param interval  每 N 期（≥1）
 * @param anchorDay 锚日号（规则首次 next_date 的日号，1-31）
 */
export function advanceDate(date: string, unit: CycleUnit, interval: number, anchorDay: number): string {
  const { y, m, d } = parseLocalDate(date)
  const step = Math.max(1, Math.floor(interval))

  if (unit === 'day') {
    const dt = new Date(y, m - 1, d + step)
    return formatYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  }
  if (unit === 'week') {
    const dt = new Date(y, m - 1, d + step * 7)
    return formatYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  }

  // month / year：锚日对齐
  const effectiveAnchor = Math.min(31, Math.max(1, Math.floor(anchorDay)))
  if (unit === 'month') {
    const total = (m - 1) + step
    const ny = y + Math.floor(total / 12)
    const nm = (total % 12) + 1
    const nd = Math.min(effectiveAnchor, daysInMonth(ny, nm))
    return formatYmd(ny, nm, nd)
  }
  // year
  const ny = y + step
  const nd = Math.min(effectiveAnchor, daysInMonth(ny, m))
  return formatYmd(ny, m, nd)
}

/** 从规则推导锚日号（首次登记日的日号；即规则的初始 next_date 日号，跨期不变） */
export function anchorDayOf(initialNextDate: string): number {
  return parseLocalDate(initialNextDate).d
}

export interface RecurringLike {
  cycle_unit: string
  cycle_interval: number
  next_date: string
  paused: number
  /** v2.0.1：仅在交易日执行（节假日/周末顺延）。缺省按 0 处理（不调整） */
  trade_day_only?: number
}

/**
 * 非交易日顺延到下一交易日（节假日 + 周末，含调休补班）。
 * 数据源见 src/data/tradingCalendar.ts（2007-2026 官方公告；数据外年份退化为仅排除周末）。
 * 应用位置：展示与入账日期；周期推进基准仍用未调整的日历日期（与券商定投「顺延不改期」一致）。
 */
export function adjustToTradingDay(date: string): string {
  return nextTradingDay(date)
}

/** 按规则的 trade_day_only 标志调整日期（关闭时原样返回） */
function adjustFor(rule: RecurringLike, date: string): string {
  return rule.trade_day_only ? adjustToTradingDay(date) : date
}

/** 是否到期：未暂停且下一期日期 ≤ 今天 */
export function isDue(rule: RecurringLike, today: string): boolean {
  return !rule.paused && rule.next_date <= today
}

/** 单次推进上限：防止极端配置（如 interval=99999）造成死循环；业务上一次补记不会超过一年 */
const MAX_ADVANCE_STEPS = 366

export interface DueWindow {
  /** 待入账的各期日期（含当前 next_date；已按锚日对齐逐期推进 + 交易日顺延后的**实际发生日**） */
  dueDates: string[]
  /** 全部到期期入账后的下一期 next_date（日历日期，未做交易日调整） */
  nextDateAfter: string
}

/**
 * 计算某规则的「到期窗口」：从当前 next_date 起，逐期推进直到日期 > today。
 * 返回空窗口表示未到期。dueDates 为交易日顺延后的实际发生日；
 * nextDateAfter 为日历日期（推进基准保持未调整，与券商定投「顺延不改期」一致）。
 * 循环步数有硬上限，超过即截断（防御性，正常配置到不了）。
 */
export function computeDueWindow(
  rule: RecurringLike,
  today: string,
  anchorDay?: number
): DueWindow {
  if (rule.paused || rule.next_date > today) {
    return { dueDates: [], nextDateAfter: rule.next_date }
  }
  const anchor = anchorDay ?? parseLocalDate(rule.next_date).d
  const dueDates: string[] = []
  let cursor = rule.next_date
  let next = cursor
  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    next = advanceDate(cursor, rule.cycle_unit as CycleUnit, rule.cycle_interval, anchor)
    // ⚠ 交易日顺延后必须**去重**：日周期/周周期跨周末时，多期日历日期可能顺延到同一个交易日
    //（实测：09-19 六、09-20 日、09-21 一 全部落到 09-21）—— 不去重会同一交易日重复记账多笔。
    const actual = adjustFor(rule, cursor)
    if (dueDates[dueDates.length - 1] !== actual) dueDates.push(actual)
    if (next > today) break
    cursor = next
  }
  return { dueDates, nextDateAfter: next }
}

/**
 * 自动入账计划（v2.0.5）：筛出「已开启自动入账、未暂停、已到期」的规则，并给出每笔要落的账。
 * 纯函数、无副作用 —— 页面只负责把计划写进库；幂等性由「落账后推进 next_date」保证
 * （推进后再次调用 dueDates 为空，不会重复记账）。
 */
export interface AutoPostItem {
  ruleId: number
  name: string
  symbol: string | null
  amount: number
  category1: string
  category2: string
  note: string
  payment_platform: string | null
  fund_account: string | null
  dueDates: string[]
  nextDateAfter: string
}

export function planAutoPost(
  rules: Array<RecurringLike & { id: number; name: string; amount: number; category1: string; category2?: string | null; note?: string | null; payment_platform?: string | null; fund_account?: string | null; symbol?: string | null; auto_post?: number }>,
  today: string,
  anchorDayOf: (date: string) => number
): AutoPostItem[] {
  const out: AutoPostItem[] = []
  for (const rule of rules) {
    if (rule.paused || rule.auto_post !== 1) continue
    const win = computeDueWindow(rule, today, anchorDayOf(rule.next_date))
    if (win.dueDates.length === 0) continue
    out.push({
      ruleId: rule.id,
      name: rule.name,
      symbol: rule.symbol ?? null,
      amount: rule.amount,
      category1: rule.category1,
      category2: rule.category2 || rule.category1,
      note: rule.note || '',
      payment_platform: rule.payment_platform ?? null,
      fund_account: rule.fund_account ?? null,
      dueDates: win.dueDates,
      nextDateAfter: win.nextDateAfter
    })
  }
  return out
}

/** 未来 N 天内将要发生的期次日期（不含今天之前；返回**交易日顺延后**的实际发生日），用于汇总卡「未来 30 天待发生」 */
export function upcomingOccurrences(
  rule: RecurringLike,
  today: string,
  days: number,
  anchorDay?: number
): string[] {
  if (rule.paused) return []
  const anchor = anchorDay ?? parseLocalDate(rule.next_date).d
  const limit = new Date(parseLocalDate(today).y, parseLocalDate(today).m - 1, parseLocalDate(today).d + days)
  const limitStr = formatYmd(limit.getFullYear(), limit.getMonth() + 1, limit.getDate())
  const out: string[] = []
  let cursor = rule.next_date
  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    if (cursor > limitStr) break
    if (cursor >= today) {
      const actual = adjustFor(rule, cursor)
      if (out[out.length - 1] !== actual) out.push(actual)
    }
    cursor = advanceDate(cursor, rule.cycle_unit as CycleUnit, rule.cycle_interval, anchor)
  }
  return out
}

/** 周期单位的展示文案由调用方经 t('天')/t('周')/t('月')/t('年') 解析（本文件保持无 UI 依赖） */
