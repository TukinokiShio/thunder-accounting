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

describe('adjustToTradingDay：节假日 + 周末顺延（数据见 src/data/tradingCalendar.ts）', () => {
  it('周六顺延到调休补班日：2026-09-19（周六）→ 09-20（周日补班，中秋 9/25-27 调休）', () => {
    expect(adjustToTradingDay('2026-09-19')).toBe('2026-09-20')
  })

  it('调休补班日是交易日：2026-09-20（周日补班）原样返回', () => {
    expect(adjustToTradingDay('2026-09-20')).toBe('2026-09-20')
  })

  it('国庆假期跨周顺延：2026-10-01（周四，国庆 10-01~10-07 休市）→ 10-08 复市首日', () => {
    expect(adjustToTradingDay('2026-10-01')).toBe('2026-10-08')
  })

  it('春节假期顺延：2026-02-16（周一，春节休市 02-15~02-23）→ 02-24 复市', () => {
    expect(adjustToTradingDay('2026-02-16')).toBe('2026-02-24')
  })

  it('调休补班日是交易日：2026-02-14（周六，春节前补班）', () => {
    expect(adjustToTradingDay('2026-02-14')).toBe('2026-02-14')
  })

  it('普通工作日原样返回；历史年份可用（2015-09-03 抗战阅兵休市 → 09-06 周日补班复市）', () => {
    expect(adjustToTradingDay('2026-09-23')).toBe('2026-09-23') // 周三
    expect(adjustToTradingDay('2015-09-03')).toBe('2015-09-06')
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

  it('到期日期顺延为补班交易日，nextDateAfter 保持日历日期（下周六）', () => {
    const win = computeDueWindow(rule, '2026-09-21', 19) // today=周一
    expect(win.dueDates).toEqual(['2026-09-20']) // 周六19 → 实际周日20（补班交易日）
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
  it('月度规则在 30 天内的期次（节假日跨周顺延）', () => {
    const rule = { cycle_unit: 'month', cycle_interval: 1, next_date: '2026-10-03', paused: 0, trade_day_only: 1 }
    // 2026-10-03 在国庆假期（10-01~10-07）→ 顺延到复市首日 10-08
    const occ = upcomingOccurrences(rule, '2026-10-01', 40, 3)
    expect(occ[0]).toBe('2026-10-08')
  })
})
