import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RecurringPage } from './Recurring'
import { useStore } from '@/store'
import type { Category, Recurring } from '@/types'

const recurringRows: Recurring[] = [
  {
    id: 1,
    name: 'Codex Plus',
    amount: 125,
    type: 'subscription',
    cycle_unit: 'month',
    cycle_interval: 1,
    next_date: '2099-10-15',
    category1: '娱乐休闲',
    category2: '会员服务',
    payment_platform: null,
    fund_account: null,
    note: null,
    paused: 0,
    trade_day_only: 0,
    auto_post: 0,
    created_at: '2026-09-28'
  },
  {
    id: 2,
    name: 'Legacy DCA',
    amount: 10,
    type: 'dca',
    cycle_unit: 'month',
    cycle_interval: 1,
    next_date: '2020-01-01',
    category1: '投资',
    category2: '基金',
    payment_platform: null,
    fund_account: null,
    note: null,
    paused: 0,
    trade_day_only: 1,
    auto_post: 1,
    created_at: '2020-01-01'
  }
]

const categories: Category[] = [{ name: '娱乐休闲', icon: '🎬', children: ['会员服务'] }]

describe('Recurring page subscriptions', () => {
  beforeEach(() => {
    ;(window as any).electronAPI = {
      getRecurrings: vi.fn().mockResolvedValue(recurringRows),
      getBills: vi.fn().mockResolvedValue([]),
      addBill: vi.fn().mockResolvedValue(undefined),
      updateRecurring: vi.fn().mockResolvedValue(undefined)
    }
    useStore.setState({ recurrings: recurringRows, expenseCategories: categories })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows both selected category levels on a subscription and excludes legacy DCA auto-posts', async () => {
    render(<RecurringPage />)

    expect(await screen.findByText('会员服务')).toBeInTheDocument()
    expect(screen.getByText('🎬')).toBeInTheDocument()
    expect(screen.queryByText('Legacy DCA')).not.toBeInTheDocument()

    await waitFor(() => {
      expect((window as any).electronAPI.getBills).toHaveBeenCalledTimes(1)
    })
    expect((window as any).electronAPI.addBill).not.toHaveBeenCalled()
    expect((window as any).electronAPI.updateRecurring).not.toHaveBeenCalled()
  })
})
