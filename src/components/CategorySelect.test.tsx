import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategorySelect } from './CategorySelect';
import { useStore } from '@/store';
import type { Category } from '@/types';

const mockExpenseCategories: Category[] = [
  { name: '餐饮食品', icon: '🍽️', children: ['早餐', '午餐', '晚餐'] },
  { name: '交通出行', icon: '🚗', children: ['公交地铁', '出租车'] },
];

const mockIncomeCategories: Category[] = [
  { name: '工资薪水', icon: '💼', children: ['基本工资', '奖金'] },
];

describe('CategorySelect', () => {
  beforeEach(() => {
    useStore.setState({
      expenseCategories: mockExpenseCategories,
      incomeCategories: mockIncomeCategories,
    });
  });

  it('should render category selection buttons', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    expect(screen.getByText('选择一级分类')).toBeInTheDocument();
    expect(screen.getByText('选择二级分类')).toBeInTheDocument();
  });

  it('should show expense categories when type is expense', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // Click to open first level dropdown
    fireEvent.click(screen.getByText('选择一级分类'));

    expect(screen.getByText('🍽️')).toBeInTheDocument();
    expect(screen.getByText('餐饮食品')).toBeInTheDocument();
    expect(screen.getByText('交通出行')).toBeInTheDocument();
  });

  it('should show income categories when type is income', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="income"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // Click to open first level dropdown
    fireEvent.click(screen.getByText('选择一级分类'));

    expect(screen.getByText('工资薪水')).toBeInTheDocument();
    // Should NOT show expense categories
    expect(screen.queryByText('餐饮食品')).not.toBeInTheDocument();
  });

  it('should call onCategory1Change when selecting a first-level category', () => {
    const onCategory1Change = vi.fn();
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={onCategory1Change}
        onCategory2Change={() => {}}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByText('选择一级分类'));
    // Select "餐饮食品"
    fireEvent.click(screen.getByText('餐饮食品'));

    expect(onCategory1Change).toHaveBeenCalledWith('餐饮食品');
  });

  it('should show selected first-level category', () => {
    render(
      <CategorySelect
        category1="餐饮食品"
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // Should show the selected category with its icon
    expect(screen.getByText(/🍽️/)).toBeInTheDocument();
    expect(screen.getByText(/餐饮食品/)).toBeInTheDocument();
  });

  it('should enable second-level dropdown when first-level is selected', () => {
    render(
      <CategorySelect
        category1="餐饮食品"
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // The second-level dropdown button should be enabled
    const secondButton = screen.getByText('选择二级分类').closest('button');
    expect(secondButton).not.toBeDisabled();
  });

  it('should disable second-level dropdown when no first-level selected', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // The second-level dropdown button should be disabled
    const secondButton = screen.getByText('选择二级分类').closest('button');
    expect(secondButton).toBeDisabled();
  });

  it('should call onCategory2Change when selecting a second-level category', () => {
    const onCategory2Change = vi.fn();
    render(
      <CategorySelect
        category1="餐饮食品"
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={onCategory2Change}
      />
    );

    // Open second-level dropdown
    fireEvent.click(screen.getByText('选择二级分类'));
    // Select "午餐"
    fireEvent.click(screen.getByText('午餐'));

    expect(onCategory2Change).toHaveBeenCalledWith('午餐');
  });

  it('should show selected second-level category', () => {
    render(
      <CategorySelect
        category1="餐饮食品"
        category2="午餐"
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // The second-level display should show the selected value
    expect(screen.getByText('午餐')).toBeInTheDocument();
  });

  it('should reset second-level category when type changes (via prop update)', () => {
    const { rerender } = render(
      <CategorySelect
        category1="餐饮食品"
        category2="午餐"
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // Switch to income type
    rerender(
      <CategorySelect
        category1=""
        category2=""
        type="income"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    expect(screen.getByText('选择一级分类')).toBeInTheDocument();
  });

  it('should close first-level dropdown after selection', () => {
    render(
      <CategorySelect
        category1=""
        category2=""
        type="expense"
        onCategory1Change={() => {}}
        onCategory2Change={() => {}}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByText('选择一级分类'));
    expect(screen.getByText('餐饮食品')).toBeInTheDocument();

    // Select a category
    fireEvent.click(screen.getByText('餐饮食品'));
    // Dropdown should close — "餐饮食品" text from the dropdown list should disappear
    // But the selected value displays "🍽️ 餐饮食品"
    // The dropdown items should no longer be visible
    const dropdownItems = screen.queryAllByRole('button').filter(
      btn => btn.textContent === '交通出行' && btn.className.includes('hover:bg-gray-50')
    );
    expect(dropdownItems).toHaveLength(0);
  });
});
