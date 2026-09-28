/**
 * 周期支出规则表单的数据模型与校验（v2.0）。
 * 「记一笔 → 周期支出」与「周期支出页 → 新增/编辑」共用，保证两条路径语义一致。
 *
 * ⚠ 本文件不得出现中文字面量：i18n 门禁要求用户可见中文全部经 t() 路由 ——
 * 校验结果返回**字段码**（field key），由调用方映射成 t('中文') 文案；
 * 平台与账户快选持久化值来自 src/data/recurringOptions.ts（数据，非 UI 文案）。
 */
import { formatLocalDate } from '@/utils/date'
import type { Category, Recurring, RecurringForm } from '@/types'

export type RecurringFormPatch = Partial<RecurringForm>

/** 空表单：与单笔支出一致，从空分类开始，由用户选择当前账号的支出分类。 */
export function emptyRecurringForm(): RecurringForm {
  return {
    name: '',
    amount: '',
    type: 'subscription',
    cycle_unit: 'month',
    cycle_interval: '1',
    next_date: formatLocalDate(),
    category1: '',
    category2: '',
    payment_platform: '',
    fund_account: '',
    note: '',
    auto_post: false
  }
}

/** 已有规则 → 表单（编辑回填） */
export function ruleToForm(rule: Recurring & { type: 'subscription' }): RecurringForm {
  return {
    name: rule.name,
    amount: String(rule.amount),
    type: 'subscription',
    cycle_unit: rule.cycle_unit,
    cycle_interval: String(rule.cycle_interval),
    next_date: rule.next_date,
    category1: rule.category1,
    category2: rule.category2 || '',
    payment_platform: rule.payment_platform || '',
    fund_account: rule.fund_account || '',
    note: rule.note || '',
    auto_post: rule.auto_post === 1
  }
}

/** 校验不通过的字段码（调用方据此映射 t() 文案）：按展示优先级排序 */
export type RecurringFieldKey = 'name' | 'amount' | 'next_date' | 'category1' | 'category2'

/** 表单校验：返回不通过的字段码（空数组 = 通过） */
export function validateRecurringForm(form: RecurringForm, expenseCategories?: readonly Category[]): RecurringFieldKey[] {
  const errors: RecurringFieldKey[] = []
  const amount = parseFloat(form.amount)
  if (!form.name.trim()) errors.push('name')
  if (isNaN(amount) || amount <= 0 || amount > 99999999.99) errors.push('amount')
  if (!form.next_date) errors.push('next_date')
  if (!form.category1.trim()) errors.push('category1')
  if (!form.category2.trim()) errors.push('category2')
  if (expenseCategories) {
    const category1 = expenseCategories.find((category) => category.name === form.category1)
    if (form.category1.trim() && !category1) errors.push('category1')
    if (form.category2.trim() && !category1?.children.includes(form.category2)) errors.push('category2')
  }
  return errors
}

/** 表单 → 写库参数（金额取整到分；订阅类型不使用交易日标志，落 0） */
export function formToRecurringParams(form: RecurringForm): Omit<Recurring, 'id' | 'created_at' | 'paused'> & { paused?: number } {
  const amount = Math.round(parseFloat(form.amount) * 100) / 100
  return {
    name: form.name.trim(),
    // Legacy DCA fields remain in storage, but new and edited rules are subscriptions only.
    symbol: null,
    auto_post: form.auto_post ? 1 : 0,
    amount,
    type: 'subscription',
    cycle_unit: form.cycle_unit,
    cycle_interval: Math.max(1, Math.floor(parseInt(form.cycle_interval, 10) || 1)),
    next_date: form.next_date,
    category1: form.category1.trim(),
    category2: form.category2.trim() || null,
    payment_platform: form.payment_platform.trim() || null,
    fund_account: form.fund_account.trim() || null,
    note: form.note.trim() || null,
    trade_day_only: 0
  }
}
