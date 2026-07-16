import { describe, it, expect } from 'vitest';
import type { Bill, Category, AddBillForm, StatsResult, CategoryRow } from './index';

describe('Type validations — Bill', () => {
  it('should accept a valid Bill object', () => {
    const bill: Bill = {
      id: 1,
      amount: 99.99,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-07-15',
      note: '测试备注',
      type: 'expense',
      created_at: '2026-07-15T12:00:00.000Z',
    };

    expect(bill.id).toBe(1);
    expect(bill.amount).toBe(99.99);
    expect(bill.type).toBe('expense');
    expect(bill.note).toBe('测试备注');
  });

  it('should accept a Bill with empty note', () => {
    const bill: Bill = {
      id: 2,
      amount: 50,
      category1: '交通出行',
      category2: '公交地铁',
      date: '2026-07-01',
      note: '',
      type: 'expense',
      created_at: '2026-07-01T08:00:00.000Z',
    };

    expect(bill.note).toBe('');
  });

  it('should accept a Bill with income type', () => {
    const bill: Bill = {
      id: 3,
      amount: 5000,
      category1: '工资薪水',
      category2: '基本工资',
      date: '2026-07-01',
      note: '',
      type: 'income',
      created_at: '2026-07-01T00:00:00.000Z',
    };

    expect(bill.type).toBe('income');
  });

  it('should validate amount is a positive number', () => {
    const validAmounts = [0.01, 1, 100, 99999.99];

    for (const amount of validAmounts) {
      const bill: Bill = {
        id: 1, amount, category1: '其他杂项',
        category2: '其他', date: '2026-01-01', note: '',
        type: 'expense', created_at: '2026-01-01T00:00:00.000Z',
      };
      expect(bill.amount).toBeGreaterThan(0);
    }
  });

  it('should validate date follows ISO format YYYY-MM-DD', () => {
    const validDates = ['2026-01-01', '2026-07-15', '2026-12-31'];

    for (const date of validDates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('should validate created_at follows ISO 8601 format', () => {
    const validTimestamps = [
      '2026-07-15T12:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ];

    for (const ts of validTimestamps) {
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

describe('Type validations — AddBillForm', () => {
  it('should accept a valid AddBillForm', () => {
    const form: AddBillForm = {
      amount: '100.50',
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-07-15',
      note: '测试',
      type: 'expense',
    };

    expect(typeof form.amount).toBe('string');
    expect(form.type).toBe('expense');
  });

  it('should accept empty string amount for initial form state', () => {
    const form: AddBillForm = {
      amount: '',
      category1: '',
      category2: '',
      date: '2026-07-15',
      note: '',
      type: 'expense',
    };

    expect(form.amount).toBe('');
    expect(form.category1).toBe('');
    expect(form.category2).toBe('');
  });

  it('should accept income type', () => {
    const form: AddBillForm = {
      amount: '5000',
      category1: '工资薪水',
      category2: '基本工资',
      date: '2026-07-01',
      note: '',
      type: 'income',
    };

    expect(form.type).toBe('income');
  });
});

describe('Type validations — Category', () => {
  it('should accept a valid Category', () => {
    const cat: Category = {
      name: '餐饮食品',
      icon: '🍽️',
      children: ['早餐', '午餐', '晚餐'],
    };

    expect(cat.name).toBe('餐饮食品');
    expect(cat.icon).toBe('🍽️');
    expect(cat.children).toHaveLength(3);
  });

  it('should accept Category with empty children array', () => {
    const cat: Category = {
      name: '新建分类',
      icon: '📦',
      children: [],
    };

    expect(cat.children).toEqual([]);
  });

  it('should accept Category with single child', () => {
    const cat: Category = {
      name: '简单分类',
      icon: '📌',
      children: ['只有一个'],
    };

    expect(cat.children).toHaveLength(1);
  });
});

describe('Type validations — StatsResult', () => {
  it('should accept valid StatsResult', () => {
    const stats: StatsResult = {
      totalAmount: 1500.50,
      count: 12,
      byCategory1: [
        { category1: '餐饮食品', total: 800, count: 6 },
        { category1: '交通出行', total: 700.50, count: 6 },
      ],
      byCategory2: [
        { category1: '餐饮食品', category2: '午餐', total: 500, count: 3 },
        { category1: '餐饮食品', category2: '晚餐', total: 300, count: 3 },
      ],
      byDate: [
        { date: '2026-07-01', total: 200, count: 2 },
        { date: '2026-07-02', total: 300, count: 3 },
      ],
    };

    expect(stats.totalAmount).toBe(1500.50);
    expect(stats.count).toBe(12);
    expect(stats.byCategory1).toHaveLength(2);
    expect(stats.byCategory2).toHaveLength(2);
    expect(stats.byDate).toHaveLength(2);
  });

  it('should accept empty StatsResult', () => {
    const stats: StatsResult = {
      totalAmount: 0,
      count: 0,
      byCategory1: [],
      byCategory2: [],
      byDate: [],
    };

    expect(stats.totalAmount).toBe(0);
    expect(stats.count).toBe(0);
    expect(stats.byCategory1).toEqual([]);
    expect(stats.byCategory2).toEqual([]);
    expect(stats.byDate).toEqual([]);
  });
});

describe('Type validations — CategoryRow', () => {
  it('should accept valid CategoryRow from database', () => {
    const row: CategoryRow = {
      id: 1,
      name: '餐饮食品',
      icon: '🍽️',
      children: '["早餐","午餐","晚餐"]',
      type: 'expense',
      is_preset: 1,
      created_at: '2026-07-01T00:00:00.000Z',
    };

    expect(row.id).toBe(1);
    expect(typeof row.children).toBe('string');
    expect(row.is_preset).toBe(1);
  });

  it('should accept CategoryRow with is_preset=0 (custom category)', () => {
    const row: CategoryRow = {
      id: 100,
      name: '自定义',
      icon: '🧪',
      children: '["子项目"]',
      type: 'expense',
      is_preset: 0,
      created_at: '2026-07-10T00:00:00.000Z',
    };

    expect(row.is_preset).toBe(0);
  });
});
