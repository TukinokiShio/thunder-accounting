/**
 * 周期推进与交易日顺延纯函数单测（v2.0 / v2.0.1）。
 * 覆盖：锚日对齐（月末不漂移）、周末顺延、到期窗口的推进基准语义（顺延不改期）。
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { advanceDate, adjustToTradingDay, computeDueWindow, upcomingOccurrences } from './recurringCycle'

describe('advanceDate：锚日对齐', () => {
  it('月周期 + 锚日 31：1月31日 → 2月末（28）→ 3月31日（不漂移）', () => {
    expect(advanceDate('2026-01-31', 'month', 1, 31)).toBe('2026-02-28')
    expect(advanceDate('2026-02-28', 'month', 1, 31)).toBe('2026-03-31')
  })

  it('每 2 周：纯加法（锚日不参与）', () => {
    expect(advanceDate('2026-09-07', 'week', 2, 7)).toBe('2026-09-21')
  })

  it('每 3 天 / 每 1 年', () => {
    expect(advanceDate('2026-09-19', 'day', 3, 19)).toBe('2026-09-22')
    expect(advanceDate('2026-09-19', 'year', 1, 19)).toBe('2027-09-19')
  })
})

describe('adjustToTradingDay：周末顺延', () => {
  it('周六 → 下周一（2026-09-19 是周六）', () => {
    expect(adjustToTradingDay('2026-09-19')).toBe('2026-09-21')
  })

  it('周日 → 下周一（2026-09-20 是周日）', () => {
    expect(adjustToTradingDay('2026-09-20')).toBe('2026-09-21')
  })

  it('工作日原样返回', () => {
    expect(adjustToTradingDay('2026-09-18')).toBe('2026-09-18') // 周五
    expect(adjustToTradingDay('2026-09-23')).toBe('2026-09-23') // 周三
  })
})

describe('computeDueWindow：顺延不改期', () => {
  const rule = {
    cycle_unit: 'week',
    cycle_interval: 1,
    next_date: '2026-09-19', // 周六，已到期
    paused: 0,
    trade_day_only: 1
  }

  it('到期日期顺延为周一，nextDateAfter 保持日历日期（下周六）', () => {
    const win = computeDueWindow(rule, '2026-09-21', 19) // today=周一
    expect(win.dueDates).toEqual(['2026-09-21']) // 周六19 → 实际周一21
    expect(win.nextDateAfter).toBe('2026-09-26') // 下期仍是周六（日历锚不变）
  })

  it('trade_day_only=0 时日期不调整', () => {
    const win = computeDueWindow({ ...rule, trade_day_only: 0 }, '2026-09-21', 19)
    expect(win.dueDates).toEqual(['2026-09-19'])
  })

  it('未到期返回空窗口', () => {
    const win = computeDueWindow({ ...rule, next_date: '2026-09-26' }, '2026-09-21', 19)
    expect(win.dueDates).toEqual([])
    expect(win.nextDateAfter).toBe('2026-09-26')
  })
})

describe('upcomingOccurrences：未来窗口', () => {
  it('月度规则在 30 天内的期次（交易日顺延）', () => {
    const rule = { cycle_unit: 'month', cycle_interval: 1, next_date: '2026-10-03', paused: 0, trade_day_only: 1 }
    // 2026-10-03 是周六 → 顺延 10-05；11-02 是周一不变
    const occ = upcomingOccurrences(rule, '2026-10-01', 40, 3)
    expect(occ[0]).toBe('2026-10-05')
  })
})
