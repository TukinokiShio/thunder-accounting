/**
 * CategoryManager 组件测试。
 * 核心回归：点击"新增分类"后编辑表单必须出现（曾存在 UI 死路——
 * 按钮把 selectedId/editName/editChildren 全部重置为空，恰好命中占位符的
 * 渲染条件，导致表单永不渲染、自定义分类无法创建）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryManager } from './CategoryManager';
import { useStore } from '@/store';
import { ANDROID_PLATFORM_CLASS } from '@/platform';

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on);
};

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

  afterEach(() => setAndroid(false));

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

  it('should open delete confirm when clicking list × without selecting a category first (regression)', async () => {
    // 模拟真实数据库返回带 id 的分类行；用户打开分类管理后不选中任何分类直接点 × 删除
    const getCategories = vi.fn().mockResolvedValue([
      { id: 7, name: '餐饮食品', icon: '🍜', children: '["午餐"]', type: 'expense', is_preset: 1 },
    ]);
    (window as unknown as { electronAPI: { getCategories: ReturnType<typeof vi.fn>; addCategory: ReturnType<typeof vi.fn> } }).electronAPI = {
      getCategories,
      addCategory: vi.fn().mockResolvedValue(undefined),
    };

    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    // 点击列表项的 ×（删除按钮）
    fireEvent.click(screen.getByTitle('删除此分类'));

    // 不得报「删除失败」；应弹出确认删除弹窗
    expect(screen.queryByText(/删除失败，请重试/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('确认删除')).toBeInTheDocument();
    });
  });

  it('should call deleteCategory with the mapped id after confirm (regression)', async () => {
    const getCategories = vi.fn().mockResolvedValue([
      { id: 7, name: '餐饮食品', icon: '🍜', children: '["午餐"]', type: 'expense', is_preset: 1 },
    ]);
    const deleteCategory = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: { getCategories: ReturnType<typeof vi.fn>; deleteCategory: ReturnType<typeof vi.fn>; addCategory: ReturnType<typeof vi.fn> } }).electronAPI = {
      getCategories,
      deleteCategory,
      addCategory: vi.fn().mockResolvedValue(undefined),
    };

    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByTitle('删除此分类'));
    await waitFor(() => expect(screen.getByText('确认删除')).toBeInTheDocument());

    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => {
      expect(deleteCategory).toHaveBeenCalledWith(7);
    });
  });

  // ── 返回路径（P0：旧版「进去出不来」）与文案/布局一致性 ──

  it('桌面整页：不渲染返回按钮（桌面靠侧栏导航，DOM 不变）', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} mode="page" />);

    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });

  it('安卓整页：页头有返回按钮，点击触发 onClose（回退入口真实可用）', () => {
    setAndroid(true);
    const onClose = vi.fn();

    render(<CategoryManager isOpen={true} onClose={onClose} mode="page" />);

    const back = screen.getByRole('button', { name: '返回' });
    expect(back).toHaveClass('category-back-btn');
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('安卓整页：空态文案与窄屏「上下堆叠」布局一致（不再写「从左侧选择」）', () => {
    setAndroid(true);

    render(<CategoryManager isOpen={true} onClose={() => {}} mode="page" />);

    expect(screen.getByText(/^选择一个分类进行编辑/)).toBeInTheDocument();
    expect(screen.queryByText(/从左侧/)).not.toBeInTheDocument();
  });

  it('桌面弹窗：空态文案保持「从左侧选择」（左右两栏布局，原样不变）', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} />);

    expect(screen.getByText(/^从左侧选择一个分类进行编辑/)).toBeInTheDocument();
  });

  it('安卓整页：非编辑模式也有可见的编辑模式提示（可发现性，不只藏在 aria-label）', () => {
    setAndroid(true);

    render(<CategoryManager isOpen={true} onClose={() => {}} mode="page" />);

    expect(screen.getByText('点右上角「编辑」可拖动排序或删除分类')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }));
    expect(screen.getByText('长按左侧把手拖动排序，点 × 删除分类')).toBeInTheDocument();
  });

  it('桌面整页：不显示编辑模式提示（该提示只服务触屏编辑模式）', () => {
    render(<CategoryManager isOpen={true} onClose={() => {}} mode="page" />);

    expect(screen.queryByText(/可拖动排序或删除分类/)).not.toBeInTheDocument();
  });
});
