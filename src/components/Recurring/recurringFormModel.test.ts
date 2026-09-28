import { describe, expect, it } from 'vitest'
import { emptyRecurringForm, formToRecurringParams, validateRecurringForm } from './recurringFormModel'
import type { Category } from '@/types'

describe('recurring form model', () => {
  const validForm = () => ({
    ...emptyRecurringForm(),
    name: 'Codex Plus',
    amount: '12.50',
    category1: '娱乐休闲',
    category2: '会员服务',
  })
  const categories: Category[] = [{ name: '娱乐休闲', icon: '🎬', children: ['会员服务'] }]

  it('requires both expense category levels', () => {
    const form = validForm()
    expect(validateRecurringForm({ ...form, category1: '' })).toContain('category1')
    expect(validateRecurringForm({ ...form, category2: '' })).toContain('category2')
    expect(validateRecurringForm(form, categories)).toEqual([])
    expect(validateRecurringForm({ ...form, category2: '未知子类' }, categories)).toContain('category2')
    expect(validateRecurringForm({ ...form, category1: '未知分类' }, categories)).toContain('category1')
  })

  it('writes a subscription and preserves both selected category values', () => {
    const params = formToRecurringParams(validForm())
    expect(params).toMatchObject({
      type: 'subscription',
      category1: '娱乐休闲',
      category2: '会员服务',
      symbol: null,
      trade_day_only: 0,
    })
  })
})
