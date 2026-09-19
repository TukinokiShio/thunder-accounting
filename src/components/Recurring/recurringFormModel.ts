/**
 * 周期支出规则表单的数据模型与校验（v2.0）。
 * 「记一笔 → 周期支出」与「周期支出页 → 新增/编辑」共用，保证两条路径语义一致。
 *
 * ⚠ 本文件不得出现中文字面量：i18n 门禁要求用户可见中文全部经 t() 路由 ——
 * 校验结果返回**字段码**（field key），由调用方映射成 t('中文') 文案；
 * 默认分类等持久化值来自 src/data/recurringOptions.ts（数据，非 UI 文案）。
 */
import { formatLocalDate } from '@/utils/date'
import { defaultCategoryFor } from '@/data/recurringOptions'
import type { Recurring, RecurringForm } from '@/types'

export type RecurringFormPatch = Partial<RecurringForm>

/** 空表单：下一期日期默认今天；默认分类按类型给（订阅→其他杂项 / 定投→金融保险，PRD §五）；
 *  定投默认勾选「仅在交易日执行」 */
export function emptyRecurringForm(type: 'subscription' | 'dca' = 'subscription'): RecurringForm {
  return {
    name: '',
    amount: '',
    type,
    cycle_unit: 'month',
    cycle_interval: '1',
    next_date: formatLocalDate(),
    category1: defaultCategoryFor(type),
    category2: '',
    payment_platform: '',
    fund_account: '',
    note: '',
    trade_day_only: type === 'dca'
  }
}

/** 已有规则 → 表单（编辑回填） */
export function ruleToForm(rule: Recurring): RecurringForm {
  return {
    name: rule.name,
    amount: String(rule.amount),
    type: rule.type,
    cycle_unit: rule.cycle_unit,
    cycle_interval: String(rule.cycle_interval),
    next_date: rule.next_date,
    category1: rule.category1,
    category2: rule.category2 || '',
    payment_platform: rule.payment_platform || '',
    fund_account: rule.fund_account || '',
    note: rule.note || '',
    trade_day_only: rule.trade_day_only === 1
  }
}

/** 校验不通过的字段码（调用方据此映射 t() 文案）：按展示优先级排序 */
export type RecurringFieldKey = 'name' | 'amount' | 'next_date' | 'category1'

/** 表单校验：返回不通过的字段码（空数组 = 通过） */
export function validateRecurringForm(form: RecurringForm): RecurringFieldKey[] {
  const errors: RecurringFieldKey[] = []
  const amount = parseFloat(form.amount)
  if (!form.name.trim()) errors.push('name')
  if (isNaN(amount) || amount <= 0 || amount > 99999999.99) errors.push('amount')
  if (!form.next_date) errors.push('next_date')
  if (!form.category1.trim()) errors.push('category1')
  return errors
}

/** 表单 → 写库参数（金额取整到分；订阅类型不使用交易日标志，落 0） */
export function formToRecurringParams(form: RecurringForm): Omit<Recurring, 'id' | 'created_at' | 'paused'> & { paused?: number } {
  const amount = Math.round(parseFloat(form.amount) * 100) / 100
  return {
    name: form.name.trim(),
    amount,
    type: form.type,
    cycle_unit: form.cycle_unit,
    cycle_interval: Math.max(1, Math.floor(parseInt(form.cycle_interval, 10) || 1)),
    next_date: form.next_date,
    category1: form.category1.trim(),
    category2: form.category2.trim() || null,
    payment_platform: form.payment_platform.trim() || null,
    fund_account: form.fund_account.trim() || null,
    note: form.note.trim() || null,
    trade_day_only: form.type === 'dca' && form.trade_day_only ? 1 : 0
  }
}
