import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecurringFormFields } from './RecurringFormFields'
import { emptyRecurringForm } from './recurringFormModel'
import { useStore } from '@/store'
import type { Category } from '@/types'

const categories: Category[] = [{ name: '娱乐休闲', icon: '🎬', children: ['会员服务'] }]

describe('RecurringFormFields', () => {
  it('keeps subscription essentials visible and folds optional details by default', () => {
    useStore.setState({ expenseCategories: categories })
    const form = { ...emptyRecurringForm(), name: 'Codex Plus', amount: '125' }

    render(<RecurringFormFields form={form} onChange={() => {}} idPrefix="recurring-form" />)

    expect(screen.getByLabelText('名称')).toBeVisible()
    expect(screen.getByLabelText('每期金额 (¥)')).toBeVisible()
    expect(document.querySelectorAll('input[role="combobox"]')).toHaveLength(2)

    const details = screen.getByText('更多信息').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByLabelText('到期自动入账（不再逐笔确认）').closest('details')).toBe(details)
  })

  it('keeps optional subscription metadata available after opening more details', () => {
    useStore.setState({ expenseCategories: categories })
    const form = { ...emptyRecurringForm(), name: 'Codex Plus', amount: '125' }
    render(<RecurringFormFields form={form} onChange={() => {}} idPrefix="recurring-form" />)

    const details = screen.getByText('更多信息').closest('details')!
    fireEvent.click(screen.getByText('更多信息'))

    expect(details).toHaveAttribute('open')
    expect(screen.getByLabelText('支付平台 (可选)')).toBeInTheDocument()
    expect(screen.getByLabelText('资金账户 (可选)')).toBeInTheDocument()
    expect(screen.getByLabelText('备注 (可选)')).toBeInTheDocument()
  })
})
