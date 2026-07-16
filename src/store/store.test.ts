import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './index';

// Mock window.electronAPI
const mockGetBills = vi.fn();

beforeEach(() => {
  // Reset store state
  useStore.setState({
    activePage: 'home',
    isAddDialogOpen: false,
    editBillId: null,
    bills: [],
    stats: null,
    filterCategory1: '',
    filterMonth: '',
    filterType: '',
    refreshTrigger: 0,
    toasts: [],
  });

  // Setup electronAPI mock
  Object.defineProperty(window, 'electronAPI', {
    value: { getBills: mockGetBills },
    writable: true,
  });

  mockGetBills.mockClear();
});

describe('useStore', () => {
  describe('activePage', () => {
    it('should default to "home"', () => {
      expect(useStore.getState().activePage).toBe('home');
    });

    it('should change active page', () => {
      useStore.getState().setActivePage('bills');
      expect(useStore.getState().activePage).toBe('bills');

      useStore.getState().setActivePage('stats');
      expect(useStore.getState().activePage).toBe('stats');
    });
  });

  describe('AddBillDialog', () => {
    it('should default to closed', () => {
      expect(useStore.getState().isAddDialogOpen).toBe(false);
      expect(useStore.getState().editBillId).toBeNull();
    });

    it('should open add dialog (create mode)', () => {
      useStore.getState().openAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBeNull();
    });

    it('should close dialog and reset editBillId', () => {
      useStore.getState().openEditDialog(42);
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBe(42);

      useStore.getState().closeAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(false);
      expect(useStore.getState().editBillId).toBeNull();
    });

    it('should open edit dialog with bill id', () => {
      useStore.getState().openEditDialog(100);
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBe(100);
    });

    it('should switch from edit mode to create mode via openAddDialog', () => {
      useStore.getState().openEditDialog(100);
      useStore.getState().openAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBeNull();
    });
  });

  describe('bills', () => {
    it('should start with empty bills array', () => {
      expect(useStore.getState().bills).toEqual([]);
    });

    it('should set bills', () => {
      const mockBills = [
        {
          id: 1,
          amount: 100,
          category1: '餐饮食品',
          category2: '午餐',
          date: '2026-07-15',
          note: '',
          type: 'expense' as const,
          created_at: '2026-07-15T12:00:00Z',
        },
      ];
      useStore.getState().setBills(mockBills);
      expect(useStore.getState().bills).toEqual(mockBills);
    });
  });

  describe('filters', () => {
    it('should default to empty filters', () => {
      const state = useStore.getState();
      expect(state.filterCategory1).toBe('');
      expect(state.filterMonth).toBe('');
      expect(state.filterType).toBe('');
    });

    it('should set filterCategory1', () => {
      useStore.getState().setFilterCategory1('餐饮食品');
      expect(useStore.getState().filterCategory1).toBe('餐饮食品');
    });

    it('should set filterMonth', () => {
      useStore.getState().setFilterMonth('2026-07');
      expect(useStore.getState().filterMonth).toBe('2026-07');
    });

    it('should set filterType', () => {
      useStore.getState().setFilterType('expense');
      expect(useStore.getState().filterType).toBe('expense');

      useStore.getState().setFilterType('income');
      expect(useStore.getState().filterType).toBe('income');

      useStore.getState().setFilterType('');
      expect(useStore.getState().filterType).toBe('');
    });
  });

  describe('stats', () => {
    it('should default to null', () => {
      expect(useStore.getState().stats).toBeNull();
    });

    it('should set stats', () => {
      const mockStats = {
        totalAmount: 500,
        count: 3,
        byCategory1: [],
        byCategory2: [],
        byDate: [],
      };
      useStore.getState().setStats(mockStats);
      expect(useStore.getState().stats).toEqual(mockStats);
    });
  });

  describe('refreshTrigger', () => {
    it('should default to 0', () => {
      expect(useStore.getState().refreshTrigger).toBe(0);
    });
  });

  describe('toasts', () => {
    it('should start with no toasts', () => {
      expect(useStore.getState().toasts).toEqual([]);
    });

    it('should add a toast', () => {
      useStore.getState().addToast('success', '操作成功');
      const toasts = useStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({
        type: 'success',
        message: '操作成功',
      });
      expect(toasts[0].id).toMatch(/^toast-/);
    });

    it('should remove a toast by id', () => {
      useStore.getState().addToast('error', '错误1');
      useStore.getState().addToast('info', '信息2');
      const toasts = useStore.getState().toasts;
      expect(toasts).toHaveLength(2);

      useStore.getState().removeToast(toasts[0].id);
      expect(useStore.getState().toasts).toHaveLength(1);
      expect(useStore.getState().toasts[0].message).toBe('信息2');
    });

    it('should have unique toast ids', () => {
      useStore.getState().addToast('success', 'A');
      useStore.getState().addToast('success', 'B');
      useStore.getState().addToast('success', 'C');
      const ids = useStore.getState().toasts.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should handle all toast types', () => {
      useStore.getState().addToast('success', '成功消息');
      useStore.getState().addToast('error', '错误消息');
      useStore.getState().addToast('info', '信息消息');

      const toasts = useStore.getState().toasts;
      expect(toasts).toHaveLength(3);
      expect(toasts[0].type).toBe('success');
      expect(toasts[1].type).toBe('error');
      expect(toasts[2].type).toBe('info');
    });

    it('should not remove wrong toast id', () => {
      useStore.getState().addToast('success', '消息');
      useStore.getState().removeToast('non-existent-id');
      expect(useStore.getState().toasts).toHaveLength(1);
    });

    it('should handle consecutive add/remove operations', () => {
      useStore.getState().addToast('info', '1');
      useStore.getState().addToast('info', '2');
      useStore.getState().addToast('info', '3');

      let toasts = useStore.getState().toasts;
      useStore.getState().removeToast(toasts[1].id);
      toasts = useStore.getState().toasts;

      expect(toasts).toHaveLength(2);
      expect(toasts[0].message).toBe('1');
      expect(toasts[1].message).toBe('3');
    });
  });

  describe('expenseCategories', () => {
    it('should start with empty array', () => {
      expect(useStore.getState().expenseCategories).toEqual([]);
    });

    it('should be settable via setState', () => {
      const cats = [{ name: '测试', icon: '🧪', children: ['子分类'] }];
      useStore.setState({ expenseCategories: cats });
      expect(useStore.getState().expenseCategories).toEqual(cats);
    });
  });

  describe('incomeCategories', () => {
    it('should start with empty array', () => {
      expect(useStore.getState().incomeCategories).toEqual([]);
    });

    it('should be settable via setState', () => {
      const cats = [{ name: '工资', icon: '💼', children: ['基本工资'] }];
      useStore.setState({ incomeCategories: cats });
      expect(useStore.getState().incomeCategories).toEqual(cats);
    });
  });

  describe('store integration scenarios', () => {
    it('should maintain state consistency across multiple actions', () => {
      const store = useStore.getState();

      // Set filters
      store.setFilterMonth('2026-07');
      store.setFilterCategory1('餐饮食品');
      store.setFilterType('expense');

      // Set bills
      const bills = [{
        id: 1, amount: 50, category1: '餐饮食品',
        category2: '午餐', date: '2026-07-15', note: '',
        type: 'expense' as const, created_at: '2026-07-15T12:00:00Z',
      }];
      store.setBills(bills);

      // Set stats
      store.setStats({
        totalAmount: 50, count: 1,
        byCategory1: [], byCategory2: [], byDate: [],
      });

      // Add toast
      store.addToast('success', '完成');

      // Verify all state
      const state = useStore.getState();
      expect(state.filterMonth).toBe('2026-07');
      expect(state.filterCategory1).toBe('餐饮食品');
      expect(state.filterType).toBe('expense');
      expect(state.bills).toEqual(bills);
      expect(state.stats).not.toBeNull();
      expect(state.toasts).toHaveLength(1);
    });

    it('should clear filters properly', () => {
      const store = useStore.getState();
      store.setFilterMonth('2026-07');
      store.setFilterCategory1('餐饮食品');
      store.setFilterType('expense');

      store.setFilterMonth('');
      store.setFilterCategory1('');
      store.setFilterType('');

      const state = useStore.getState();
      expect(state.filterMonth).toBe('');
      expect(state.filterCategory1).toBe('');
      expect(state.filterType).toBe('');
    });

    it('should open/close dialog without affecting other state', () => {
      const store = useStore.getState();
      store.setFilterMonth('2026-07');

      store.openAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().filterMonth).toBe('2026-07');

      store.closeAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(false);
      expect(useStore.getState().filterMonth).toBe('2026-07');
    });

    it('should correctly switch between edit and create modes', () => {
      const store = useStore.getState();

      // Open edit mode
      store.openEditDialog(99);
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBe(99);

      // Switch to create mode
      store.openAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(true);
      expect(useStore.getState().editBillId).toBeNull();

      // Close
      store.closeAddDialog();
      expect(useStore.getState().isAddDialogOpen).toBe(false);
      expect(useStore.getState().editBillId).toBeNull();
    });
  });
});
