import { describe, it, expect } from 'vitest';
import { presetCategories } from './categories';
import type { Category } from '@/types';

describe('presetCategories', () => {
  it('should have 11 main categories', () => {
    expect(presetCategories).toHaveLength(11);
  });

  it('should have total 61 subcategories', () => {
    const totalChildren = presetCategories.reduce(
      (sum, cat) => sum + cat.children.length,
      0
    );
    expect(totalChildren).toBe(61);
  });

  it('each category should have a non-empty name', () => {
    for (const cat of presetCategories) {
      expect(cat.name).toBeTruthy();
      expect(typeof cat.name).toBe('string');
    }
  });

  it('each category should have an emoji icon', () => {
    const emojiRegex = /\p{Emoji}/u;
    for (const cat of presetCategories) {
      expect(cat.icon).toMatch(emojiRegex);
    }
  });

  it('each category should have at least one child', () => {
    for (const cat of presetCategories) {
      expect(cat.children.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all child names should be non-empty strings', () => {
    for (const cat of presetCategories) {
      for (const child of cat.children) {
        expect(child).toBeTruthy();
        expect(typeof child).toBe('string');
      }
    }
  });

  it('should have no duplicate category names', () => {
    const names = presetCategories.map((c) => c.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('should contain expected main categories', () => {
    const names = presetCategories.map((c) => c.name);
    expect(names).toContain('餐饮食品');
    expect(names).toContain('交通出行');
    expect(names).toContain('购物消费');
    expect(names).toContain('住房物业');
    expect(names).toContain('医疗健康');
    expect(names).toContain('教育学习');
    expect(names).toContain('娱乐休闲');
    expect(names).toContain('人情往来');
    expect(names).toContain('金融保险');
    expect(names).toContain('旅游出行');
    expect(names).toContain('其他杂项');
  });

  it('each category should conform to Category type shape', () => {
    for (const cat of presetCategories) {
      expect(cat).toHaveProperty('name');
      expect(cat).toHaveProperty('icon');
      expect(cat).toHaveProperty('children');
      expect(Array.isArray(cat.children)).toBe(true);
    }
  });
});
