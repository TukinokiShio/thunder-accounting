/**
 * CategoryManager 组件测试。
 * 核心回归：点击"新增分类"后编辑表单必须出现（曾存在 UI 死路——
 * 按钮把 selectedId/editName/editChildren 全部重置为空，恰好命中占位符的
 * 渲染条件，导致表单永不渲染、自定义分类无法创建）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryManager } from './CategoryManager';
import { useStore } from '@/store';

describe('CategoryManager', () => {
  beforeEach(() => {
    // 预置一个支出分类，收入分类留空（用于验证占位符分支）
    useStore.setState({
      expenseCategories: [{ name: '餐饮食品', icon: '🍜', children: ['午餐'] }],
      incomeCategories: [],
      refreshCategories: vi.fn().mockResolvedValue(undefined),
    });
    // mock IPC 桥，避免真实主进程调用
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getCategories: vi.fn().mockResolvedValue([]),
      addCategory: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should show placeholder initially when nothing is selected', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    expect(screen.getByText(/从左侧选择一个分类进行编辑/)).toBeInTheDocument();
  });

  it('should show the empty editor form when "新增分类" is clicked (regression)', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('新增分类'));

    // 回归点：表单必须出现，而不是停留在占位符
    expect(screen.getByText('分类名称')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入一级分类名称')).toBeInTheDocument();
    expect(screen.getByText('创建分类')).toBeInTheDocument();
  });

  it('should call addCategory when the new-category form is submitted', async () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('新增分类'));
    await userEvent.type(screen.getByPlaceholderText('输入一级分类名称'), '宠物');
    await userEvent.type(screen.getByPlaceholderText('输入二级分类名称'), '猫粮');
    fireEvent.click(screen.getByText('添加'));
    fireEvent.click(screen.getByText('创建分类'));

    await waitFor(() => {
      const api = (window as unknown as { electronAPI: { addCategory: ReturnType<typeof vi.fn> } }).electronAPI;
      expect(api.addCategory).toHaveBeenCalledWith(
        expect.objectContaining({ name: '宠物', type: 'expense', children: ['猫粮'] })
      );
    });
  });

  it('should return to placeholder when switching tab during creation', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('新增分类'));
    expect(screen.getByText('分类名称')).toBeInTheDocument();

    // 切换 tab 应复位 isCreating，收入分类为空 → 显示"暂无分类"占位符
    fireEvent.click(screen.getByText('收入分类'));
    expect(screen.getByText(/暂无分类/)).toBeInTheDocument();
  });
});
