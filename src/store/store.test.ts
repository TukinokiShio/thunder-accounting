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
  });
});
