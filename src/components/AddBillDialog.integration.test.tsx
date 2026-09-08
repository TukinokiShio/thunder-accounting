import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '@/store'
import { AddBillDialog } from './AddBillDialog'
import type { Category } from '@/types'

const mockAddBill = vi.fn().mockResolvedValue({})
const categories: Category[] = [{ name: '餐饮食品', icon: '🍽️', children: ['午餐'] }]

vi.mock('./AddBillDatePicker', () => ({
  AddBillDatePicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" aria-label="测试日期选择器" onClick={() => onChange('2026-08-15')}>
      测试日期选择器
    </button>
  ),
}))

describe('AddBillDialog date contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      isAddDialogOpen: true,
      editBillId: null,
      bills: [],
      expenseCategories: categories,
      incomeCategories: [],
    })
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      value: {
        addBill: mockAddBill,
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
})
