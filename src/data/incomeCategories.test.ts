import { describe, it, expect } from 'vitest';
import { incomeCategories } from './incomeCategories';
import type { Category } from '@/types';

describe('incomeCategories', () => {
  it('should have 6 main categories', () => {
    expect(incomeCategories).toHaveLength(6);
  });

  it('should have total 17 subcategories', () => {
    const totalChildren = incomeCategories.reduce(
      (sum, cat) => sum + cat.children.length,
      0
    );
    // 工资薪水(3) + 兼职副业(3) + 投资理财(3) + 红包转账(3) + 退款报销(3) + 其他收入(2) = 17
    expect(totalChildren).toBe(17);
  });

  it('each category should have a non-empty name', () => {
    for (const cat of incomeCategories) {
      expect(cat.name).toBeTruthy();
      expect(typeof cat.name).toBe('string');
    }
  });

  it('each category should have an emoji icon', () => {
    const emojiRegex = /\p{Emoji}/u;
    for (const cat of incomeCategories) {
      expect(cat.icon).toMatch(emojiRegex);
    }
  });

  it('each category should have at least one child', () => {
    for (const cat of incomeCategories) {
      expect(cat.children.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all child names should be non-empty strings', () => {
    for (const cat of incomeCategories) {
      for (const child of cat.children) {
        expect(child).toBeTruthy();
        expect(typeof child).toBe('string');
      }
    }
  });

  it('should have no duplicate category names', () => {
    const names = incomeCategories.map((c) => c.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('should contain expected main categories', () => {
    const names = incomeCategories.map((c) => c.name);
    expect(names).toContain('工资薪水');
    expect(names).toContain('兼职副业');
    expect(names).toContain('投资理财');
    expect(names).toContain('红包转账');
    expect(names).toContain('退款报销');
    expect(names).toContain('其他收入');
  });

  it('each category should conform to Category type shape', () => {
    for (const cat of incomeCategories) {
      expect(cat).toHaveProperty('name');
      expect(cat).toHaveProperty('icon');
      expect(cat).toHaveProperty('children');
      expect(Array.isArray(cat.children)).toBe(true);
    }
  });

  it('should have unique children within each category', () => {
    for (const cat of incomeCategories) {
      const uniqueChildren = new Set(cat.children);
      expect(uniqueChildren.size).toBe(cat.children.length);
    }
  });

  it('all categories should be valid Category type objects', () => {
    const cats: Category[] = incomeCategories;
    expect(cats.every(c =>
      typeof c.name === 'string' &&
      typeof c.icon === 'string' &&
      Array.isArray(c.children) &&
      c.children.every(ch => typeof ch === 'string')
    )).toBe(true);
  });
});
