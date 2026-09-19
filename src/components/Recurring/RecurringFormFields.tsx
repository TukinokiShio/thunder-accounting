/**
 * 周期支出规则表单字段集（v2.0）。
 * 「记一笔 → 周期支出」模块与「周期支出页 → 新增/编辑弹窗」共用同一套字段，
 * 保证两条创建路径的字段与校验语义完全一致。
 *
 * ⚠ i18n 门禁：全部文案走 t()，词典 key 见 translations.ts（N6 单写者维护）。
 */
import { useLanguage } from '@/i18n/LanguageContext'
import { AddBillDatePicker } from '../AddBillDatePicker'
import { PAYMENT_PLATFORM_OPTIONS, FUND_ACCOUNT_OPTIONS, SUBSCRIPTION_CATEGORY_OPTIONS, DCA_CATEGORY_OPTIONS } from '@/data/recurringOptions'
import type { RecurringFieldKey } from './recurringFormModel'
import type { RecurringForm } from '@/types'

/** 字段码 → t() 文案（中文文案集中在此路由，模型层保持无中文） */
export function firstRecurringErrorMessage(errors: RecurringFieldKey[], t: (k: string) => string): string {
  const code = errors[0]
  if (code === 'name') return t('请填写名称')
  if (code === 'amount') return t('请输入有效的金额')
  if (code === 'next_date') return t('请选择下一期日期')
  return t('请填写入账分类')
}

interface Props {
  form: RecurringForm
  onChange: (patch: Partial<RecurringForm>) => void
  idPrefix: string
}

/**
 * 自由输入 + 快选芯片（v2.0.3）。
 * 取代原来的 `<datalist>`：datalist 在 Chromium 下点击即弹下拉、且会被浏览器自动填充，
 * 用户感知为「只能选不能填」。现在明确为「文本输入框（随便写）+ 一排快选芯片（点一下填入）」。
 */
function OptionInput(props: {
  id: string
  value: string
  options: string[]
  placeholder: string
  onChange: (v: string) => void
}) {
  return (
    <>
      <input
        id={props.id}
        type="text"
        maxLength={50}
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="input-field"
      />
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {props.options.map((opt) => {
          const selected = props.value === opt
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onChange(selected ? '' : opt)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors
                ${selected
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </>
  )
}

export function RecurringFormFields({ form, onChange, idPrefix }: Props) {
  const { t } = useLanguage()

  const cycleUnitLabel = { day: t('天'), week: t('周'), month: t('月'), year: t('年') }
  // 快选值是持久化数据（src/data/recurringOptions.ts），展示时经 t() 翻译
  const platformOptions = PAYMENT_PLATFORM_OPTIONS.map((k) => t(k))
  const accountOptions = FUND_ACCOUNT_OPTIONS.map((k) => t(k))

  return (
    <>
      {/* 名称：订阅了什么 / 定投什么标的 */}
      <div>
        <label htmlFor={`${idPrefix}-name`} className="block text-sm font-medium text-gray-700 mb-1">{t('名称')}</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          placeholder={form.type === 'dca' ? t('如：华安纳斯达克ETF联接A') : t('如：Codex Plus')}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="input-field"
        />
      </div>

      {/* 类型：订阅 / 定投 */}
      <div>
        <span id={`${idPrefix}-rtype-label`} className="block text-sm font-medium text-gray-700 mb-1">{t('类型')}</span>
        <div role="group" aria-labelledby={`${idPrefix}-rtype-label`} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {(['subscription', 'dca'] as const).map((rt) => (
            <button
              key={rt}
              type="button"
              aria-pressed={form.type === rt}
              onClick={() => onChange({ type: rt, category1: '', category2: '' })}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${form.type === rt
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
            >
              {rt === 'subscription' ? t('订阅') : t('定投')}
            </button>
          ))}
        </div>
      </div>

      {/* 金额（每期） */}
      <div>
        <label htmlFor={`${idPrefix}-amount`} className="block text-sm font-medium text-gray-700 mb-1">
          {form.type === 'dca' ? t('每期定投金额 (¥)') : t('每期金额 (¥)')}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-red-500">¥</span>
          <input
            id={`${idPrefix}-amount`}
            type="number"
            step="0.01"
            min="0.01"
            max="99999999.99"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            className="input-field pl-8 text-lg font-mono font-medium"
          />
        </div>
      </div>

      {/* 周期：单位 + 间隔（每 N 天/周/月/年）。
          ⚠ 布局：间隔输入框必须包在固定宽度容器里 —— .input-field 全局 width:100%
          会盖掉输入框自身的 w-20（index.css:207），导致单位按钮被挤出可视区。 */}
      <div>
        <span id={`${idPrefix}-cycle-label`} className="block text-sm font-medium text-gray-700 mb-1">{t('周期')}</span>
        <div role="group" aria-labelledby={`${idPrefix}-cycle-label`} className="flex items-center gap-2">
          <span className="text-sm text-gray-500 shrink-0">{t('每')}</span>
          <div className="w-20 shrink-0">
            <input
              id={`${idPrefix}-interval`}
              type="number"
              min="1"
              max="999"
              value={form.cycle_interval}
              onChange={(e) => onChange({ cycle_interval: e.target.value })}
              className="input-field text-center"
              aria-label={t('周期间隔')}
            />
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-4 gap-1">
            {(['day', 'week', 'month', 'year'] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                aria-pressed={form.cycle_unit === unit}
                onClick={() => onChange({ cycle_unit: unit })}
                className={`py-1.5 rounded-md text-sm font-medium transition-colors min-w-0
                  ${form.cycle_unit === unit
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-600'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {cycleUnitLabel[unit]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 定投专属：仅在交易日执行（法定节假日与周末自动顺延，调休补班日正常执行） */}
      {form.type === 'dca' && (
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-trade-day`}
            type="checkbox"
            checked={form.trade_day_only}
            onChange={(e) => onChange({ trade_day_only: e.target.checked })}
            className="h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <label htmlFor={`${idPrefix}-trade-day`} className="text-sm text-gray-700 dark:text-gray-300 select-none">
            {t('仅在交易日执行（节假日与周末自动顺延）')}
          </label>
        </div>
      )}

      {/* 下一期日期 */}
      <div>
        <label htmlFor={`${idPrefix}-next-date`} className="block text-sm font-medium text-gray-700 mb-1">{t('下一期日期')}</label>
        <AddBillDatePicker
          id={`${idPrefix}-next-date`}
          value={form.next_date}
          onChange={(date) => onChange({ next_date: date })}
        />
      </div>

      {/* 分类（生成账单归入；默认按类型预填，可改） */}
      <div>
        <label htmlFor={`${idPrefix}-category`} className="block text-sm font-medium text-gray-700 mb-1">{t('入账分类')}</label>
        <OptionInput
          id={`${idPrefix}-category`}
          value={form.category1}
          options={(form.type === 'dca' ? DCA_CATEGORY_OPTIONS : SUBSCRIPTION_CATEGORY_OPTIONS).map((k) => t(k))}
          placeholder={t('如：其他杂项 / 金融保险')}
          onChange={(v) => onChange({ category1: v })}
        />
      </div>

      {/* 支付平台（选填）：在哪笔交易发生 */}
      <div>
        <label htmlFor={`${idPrefix}-platform`} className="block text-sm font-medium text-gray-700 mb-1">
          {t('支付平台')} <span className="text-gray-400 font-normal">{t('(可选)')}</span>
        </label>
        <OptionInput
          id={`${idPrefix}-platform`}
          value={form.payment_platform}
          options={platformOptions}
          placeholder={t('如：微信 / 支付宝 / Apple Pay')}
          onChange={(v) => onChange({ payment_platform: v })}
        />
      </div>

      {/* 资金账户（选填）：钱从哪个账户出 */}
      <div>
        <label htmlFor={`${idPrefix}-account`} className="block text-sm font-medium text-gray-700 mb-1">
          {t('资金账户')} <span className="text-gray-400 font-normal">{t('(可选)')}</span>
        </label>
        <OptionInput
          id={`${idPrefix}-account`}
          value={form.fund_account}
          options={accountOptions}
          placeholder={t('如：银行卡 / 微信零钱 / 信用卡')}
          onChange={(v) => onChange({ fund_account: v })}
        />
      </div>

      {/* 备注（选填） */}
      <div>
        <label htmlFor={`${idPrefix}-note`} className="block text-sm font-medium text-gray-700 mb-1">
          {t('备注')} <span className="text-gray-400 font-normal">{t('(可选)')}</span>
        </label>
        <input
          id={`${idPrefix}-note`}
          type="text"
          maxLength={200}
          autoComplete="off"
          placeholder={t('添加备注...')}
          value={form.note}
          onChange={(e) => onChange({ note: e.target.value })}
          className="input-field"
        />
      </div>
    </>
  )
}
