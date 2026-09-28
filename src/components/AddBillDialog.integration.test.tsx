import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '@/store'
import { AddBillDialog } from './AddBillDialog'
import type { Category } from '@/types'

const mockAddBill = vi.fn().mockResolvedValue({})
const mockAddRecurring = vi.fn().mockResolvedValue({})
const mockUpdateRecurring = vi.fn().mockResolvedValue({})
const categories: Category[] = [{ name: '餐饮食品', icon: '🍽️', children: ['午餐'] }]

vi.mock('./AddBillDatePicker', () => ({
  AddBillDatePicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" aria-label="测试日期选择器" onClick={() => onChange('2026-08-15')}>
      测试日期选择器
    </button>
  ),
}))

describe('AddBillDialog contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      isAddDialogOpen: true,
      editBillId: null,
      recurringPreset: null,
      bills: [],
      expenseCategories: categories,
      incomeCategories: [],
    })
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      value: {
        addBill: mockAddBill,
        addRecurring: mockAddRecurring,
        updateRecurring: mockUpdateRecurring,
        getRecurrings: vi.fn().mockResolvedValue([]),
        getBills: vi.fn().mockResolvedValue([]),
      },
    })
  })

  it('passes the selected date to addBill without changing the stored format', async () => {
    const user = userEvent.setup()
    render(<AddBillDialog />)

    await user.type(screen.getByLabelText('金额 (¥)'), '12.50')
    await user.click(screen.getByRole('combobox', { name: '一级分类' }))
    await user.click(screen.getByRole('option', { name: '🍽️ 餐饮食品' }))
    await user.click(screen.getByRole('combobox', { name: '二级分类' }))
    await user.click(screen.getByRole('option', { name: '午餐' }))
    await user.click(screen.getByRole('button', { name: '测试日期选择器' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockAddBill).toHaveBeenCalledWith(expect.objectContaining({
      amount: 12.5,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-08-15',
      type: 'expense',
    })))
  })

  it('creates a subscription using both levels from the shared expense category selector', async () => {
    const user = userEvent.setup()
    render(<AddBillDialog />)

    await user.click(screen.getByRole('button', { name: '周期支出' }))
    await user.type(screen.getByLabelText('名称'), 'Codex Plus')
    await user.type(screen.getByLabelText('每期金额 (¥)'), '12.50')
    await user.click(screen.getByRole('combobox', { name: '一级分类' }))
    await user.click(screen.getByRole('option', { name: '🍽️ 餐饮食品' }))
    await user.click(screen.getByRole('combobox', { name: '二级分类' }))
    await user.click(screen.getByRole('option', { name: '午餐' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockAddRecurring).toHaveBeenCalledWith(expect.objectContaining({
      type: 'subscription',
      category1: '餐饮食品',
      category2: '午餐',
      trade_day_only: 0,
      symbol: null,
    })))
    expect(screen.queryByText('定投')).not.toBeInTheDocument()
  })

  it('blocks a legacy DCA preset before adding or advancing any bill', async () => {
    const user = userEvent.setup()
    useStore.setState({
      recurringPreset: {
        recurringId: 42,
        type: 'dca',
        name: 'Legacy rule',
        amount: 12.5,
        category1: '餐饮食品',
        category2: '午餐',
        paymentPlatform: '',
        fundAccount: '',
        dueDates: ['2026-08-15'],
        nextDateAfter: '2026-09-15',
      },
    })
    render(<AddBillDialog />)

    await user.click(screen.getByRole('button', { name: '确认入账' }))

    expect(await screen.findByText('操作失败，请重试')).toBeInTheDocument()
    expect(mockAddBill).not.toHaveBeenCalled()
    expect(mockUpdateRecurring).not.toHaveBeenCalled()
  })
})
