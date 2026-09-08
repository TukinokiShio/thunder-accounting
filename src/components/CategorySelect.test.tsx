import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategorySelect } from './CategorySelect'
import { useStore } from '@/store'
import type { Category } from '@/types'

const mockExpenseCategories: Category[] = [
  { name: '餐饮食品', icon: '🍽️', children: ['早餐', '午餐', '晚餐'] },
  { name: '交通出行', icon: '🚗', children: ['公交地铁', '出租车'] },
]

const mockIncomeCategories: Category[] = [
  { name: '工资薪水', icon: '💼', children: ['基本工资', '奖金'] },
]

/**
 * CategorySelect v1.7.21 已迁移到 react-select。
 * 本测试验证与 AddBillDialog 的 API 契约和本次 UI 状态约束，
 * 不复制 react-select 的内部实现测试。
 */
describe('CategorySelect (react-select)', () => {
  beforeEach(() => {
    useStore.setState({
      expenseCategories: mockExpenseCategories,
      incomeCategories: mockIncomeCategories,
    })
  })

  it('renders two selects (level 1 and level 2)', () => {
    render(
      <CategorySelect category1="" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    expect(document.querySelectorAll('.rs__control')).toHaveLength(2)
  })

  it('shows level 1 placeholder when empty', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    )
    expect(screen.getByText('选择一级分类')).toBeInTheDocument()
  })

  it('gives each category combobox an accessible name', () => {
    render(
      <CategorySelect category1="" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    const comboboxes = document.querySelectorAll('input[role="combobox"]')
    expect(comboboxes).toHaveLength(2)
    expect(comboboxes[0]).toHaveAttribute('aria-label', '一级分类')
    expect(comboboxes[1]).toHaveAttribute('aria-label', '二级分类')
  })

  it('shows level 2 placeholder when empty', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    )
    expect(screen.getByText('选择二级分类')).toBeInTheDocument()
  })

  it('disables level 2 select when no level 1 selected', () => {
    render(
      <CategorySelect category1="" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    expect(document.querySelectorAll('.rs__control--is-disabled')).toHaveLength(1)
  })

  it('enables level 2 select when level 1 selected', () => {
    render(
      <CategorySelect category1="餐饮食品" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    expect(document.querySelectorAll('.rs__control--is-disabled')).toHaveLength(0)
  })

  it('applies a single gold focus state to the active control', async () => {
    const user = userEvent.setup()
    render(
      <CategorySelect category1="" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    const comboboxes = screen.getAllByRole('combobox')
    await user.click(comboboxes[0])
    const controls = document.querySelectorAll('.rs__control')
    expect(controls).toHaveLength(2)
    expect(controls[0]).toHaveClass('rs__control--is-focused')
    expect(controls[1]).not.toHaveClass('rs__control--is-focused')
  })

  it('uses high-contrast ink for selected gold options', async () => {
    const user = userEvent.setup()
    render(
      <CategorySelect category1="餐饮食品" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    await user.click(screen.getAllByRole('combobox')[0])
    expect(screen.getByRole('option', { name: '🍽️ 餐饮食品' })).toHaveStyle({
      color: 'var(--accent-ink)',
      backgroundColor: 'var(--accent)'
    })
  })

  it('shows selected level 1 category with emoji prefix', () => {
    render(
      <CategorySelect
        category1="餐饮食品"
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    )
    // react-select shows the full label (icon + name)
    expect(screen.getByText('🍽️ 餐饮食品')).toBeInTheDocument()
  })

  it('calls onCategory1Change when selecting expense category', async () => {
    const user = userEvent.setup()
    const onCategory1Change = vi.fn()
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={onCategory1Change}
        onCategory2Change={() => {}}
      />
    )
    const comboboxes = screen.getAllByRole('combobox')
    await user.click(comboboxes[0])
    await user.keyboard('餐饮')
    const option = await screen.findByText('🍽️ 餐饮食品')
    await user.click(option)
    expect(onCategory1Change).toHaveBeenCalledWith('餐饮食品')
  })

  it('uses income categories when type=income', async () => {
    const user = userEvent.setup()
    const onCategory1Change = vi.fn()
    render(
      <CategorySelect
        category1=""
        category2=""
        type="income"
        onCategory1Change={onCategory1Change}
        onCategory2Change={() => {}}
      />
    )
    const comboboxes = screen.getAllByRole('combobox')
    await user.click(comboboxes[0])
    await user.keyboard('工资')
    const option = await screen.findByText('💼 工资薪水')
    await user.click(option)
    expect(onCategory1Change).toHaveBeenCalledWith('工资薪水')
  })

  it('does not show expense categories when type=income', async () => {
    const user = userEvent.setup()
    render(
      <CategorySelect
        category1=""
        category2=""
        type="income"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    )
    const comboboxes = screen.getAllByRole('combobox')
    await user.click(comboboxes[0])
    await user.keyboard('餐饮')
    // Should not find expense category in income type
    expect(screen.queryByText('🍽️ 餐饮食品')).not.toBeInTheDocument()
  })

  it('keeps the portal menu inside the themed shell', async () => {
    const user = userEvent.setup()
    const shell = document.createElement('div')
    shell.className = 'dark aurora-shell'
    document.body.appendChild(shell)

    const { unmount } = render(
      <CategorySelect category1="" category2="" type="expense"
        onCategory1Change={() => {}} onCategory2Change={() => {}} />
    )
    await user.click(screen.getAllByRole('combobox')[0])

    expect(document.querySelector('.rs__menu')?.closest('.aurora-shell')).toBe(shell)

    unmount()
    shell.remove()
  })
})
