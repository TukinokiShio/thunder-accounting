import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Repeat } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { formatLocalDate } from '@/utils/date'
import { modalPortalScope } from '@/utils/modalScope'
import { CategorySelect } from './CategorySelect'
import { AddBillDatePicker } from './AddBillDatePicker'
import { RecurringFormFields, firstRecurringErrorMessage, recurringErrorMap } from './Recurring/RecurringFormFields'
import { emptyRecurringForm, validateRecurringForm, formToRecurringParams, type RecurringFormPatch, type RecurringFieldKey } from './Recurring/recurringFormModel'
import { defaultCategoryFor } from '@/data/recurringOptions'
import type { AddBillForm, RecurringForm } from '@/types'

/**
 * 获取空的账单表单初始值。
 * 用函数包装而非静态对象，是为了延迟调用 formatLocalDate()：
 * 如果在模块导入阶段调用，i18n/settings 可能尚未初始化，会导致白屏。
 */
const getEmptyForm = (): AddBillForm => ({
  amount: '',
  category1: '',
  category2: '',
  date: formatLocalDate(),
  note: '',
  type: 'expense'
})

/**
 * 记账弹窗组件（新增 + 编辑复用）。
 * 编辑模式下根据 editBillId 从 bills 中查找已有记录并回填表单。
 * 提交流程：表单校验 → 浮点精度处理 → 调用主进程 IPC → Toast 反馈 → 刷新列表。
 */
export function AddBillDialog() {
  const isOpen = useStore((s) => s.isAddDialogOpen)
  const editBillId = useStore((s) => s.editBillId)
  const bills = useStore((s) => s.bills)
  const recurringPreset = useStore((s) => s.recurringPreset)
  const closeAddDialog = useStore((s) => s.closeAddDialog)
  const refreshBills = useStore((s) => s.refreshBills)
  const addToast = useStore((s) => s.addToast)
  const notifyChange = useStore((s) => s.notifyChange)
  const addRecurringAction = useStore((s) => s.addRecurringAction)
  const updateRecurringAction = useStore((s) => s.updateRecurringAction)
  const refreshRecurrings = useStore((s) => s.refreshRecurrings)
  const { t } = useLanguage()

  const [form, setForm] = useState<AddBillForm>(getEmptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [futureWarning, setFutureWarning] = useState(false)
  /** v2.0.4：单笔模式的字段级错误（就地红字 + aria-invalid） */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'amount' | 'category1' | 'category2' | 'date', string>>>({})
  /** v2.0.4：周期模块的字段级错误 */
  const [recFieldErrors, setRecFieldErrors] = useState<Partial<Record<RecurringFieldKey, string>>>({})
  // v2.0：支出侧双模块。「单笔支出」= 既有流程；「周期支出」= 登记周期规则（不即时落账）。
  // 仅在「新增 + 支出 + 非一键入账预填」时可见；编辑/收入/预填态无此切换。
  const [expenseModule, setExpenseModule] = useState<'single' | 'recurring'>('single')
  const [recForm, setRecForm] = useState<RecurringForm>(emptyRecurringForm)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const isEditMode = editBillId !== null
  const isPresetMode = recurringPreset !== null
  const showModuleSwitch = !isEditMode && !isPresetMode && form.type === 'expense'

  // 编辑模式：根据 editBillId 查找已有账单并回填表单
  useEffect(() => {
    if (isEditMode) {
      const bill = bills.find((b) => b.id === editBillId)
      if (bill) {
        setForm({
          amount: String(bill.amount),
          category1: bill.category1,
          category2: bill.category2,
          date: bill.date,
          note: bill.note,
          type: (bill.type as 'expense' | 'income') || 'expense'
        })
      }
    } else {
      resetForm()
    }
  }, [isEditMode, editBillId])

  // 一键入账预填模式：按到期规则预填单笔表单（金额/分类/日期=首期/备注=规则名）
  useEffect(() => {
    if (isOpen && recurringPreset) {
      setForm({
        amount: String(recurringPreset.amount),
        category1: recurringPreset.category1,
        category2: recurringPreset.category2 || '',
        date: recurringPreset.dueDates[0] ?? formatLocalDate(),
        note: recurringPreset.name,
        type: 'expense'
      })
      setExpenseModule('single')
      setError('')
      setFutureWarning(false)
    }
  }, [isOpen, recurringPreset])

  useEffect(() => {
    if (!isOpen) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    amountInputRef.current?.focus()

    return () => {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [isOpen])

  const resetForm = useCallback(() => {
    setForm({
      ...getEmptyForm(),
      date: formatLocalDate()
    })
    setExpenseModule('single')
    setRecForm(emptyRecurringForm())
    setError('')
    setFieldErrors({})
    setRecFieldErrors({})
    setFutureWarning(false)
  }, [])

  const patchRecForm = (patch: RecurringFormPatch) => {
    setRecForm((prev) => {
      const next = { ...prev, ...patch }
      // 切换类型时重置默认分类（订阅→其他杂项 / 定投→金融保险）与交易日标志（定投默认开）
      if (patch.type && patch.type !== prev.type) {
        next.category1 = defaultCategoryFor(patch.type)
        next.trade_day_only = patch.type === 'dca'
      }
      return next
    })
  }

  const typeLabel = form.type === 'income' ? t('收入') : t('支出')

  const handleClose = () => {
    resetForm()
    closeAddDialog()
  }

  /**
   * v2.0.4 校验失败统一出口：**四件事一起做**，不再只写一行藏在下方的文案 ——
   * ① 字段级红字（就地可见）② 汇总文案（固定在按钮上方）③ toast（跨滚动位置可见）
   * ④ 滚动 + 聚焦到首个问题字段。
   * 背景：2026-09-19 用户反馈「漏填后保存不了、没有任何提醒」——根因是错误文案挂在
   * 可滚动内容底部，用户没滚到底就看不到。
   */
  const reportValidationFailure = (
    fieldMap: Record<string, string | undefined>,
    firstMessage: string,
    focusId: string,
    fallbackSelector?: string
  ) => {
    // v2.0.5：校验类错误**只**给「字段级红字 + toast」——用户明确要求去掉底部汇总条
    //（字段下方已有红字，底部再来一条是重复噪音）。futureWarning（未来日期二次确认）
    // 属于非字段级警告，另行 setError 渲染在按钮上方，必须可见。
    addToast('error', firstMessage)
    setTimeout(() => {
      const el = document.getElementById(focusId) ?? (fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null)
      el?.scrollIntoView({ block: 'center' })
      el?.focus?.()
    }, 0)
  }

  /** 周期支出模块提交：登记规则（不即时落账），规则在到期后由页面/提醒引导入账 */
  const handleRecurringSubmit = async () => {
    setError('')
    const errors = validateRecurringForm(recForm)
    if (errors.length > 0) {
      const map = recurringErrorMap(errors, t)
      setRecFieldErrors(map)
      const focusId = { name: 'add-bill-rec-name', amount: 'add-bill-rec-amount', next_date: 'add-bill-rec-next-date', category1: 'add-bill-rec-category' }[errors[0]]
      reportValidationFailure(map, firstRecurringErrorMessage(errors, t), focusId)
      return
    }
    setRecFieldErrors({})

    setSubmitting(true)
    try {
      const params = formToRecurringParams(recForm)
      await addRecurringAction(params)
      addToast('success', t('已添加周期支出：{name}').replace('{name}', params.name))
      notifyChange()
      resetForm()
      closeAddDialog()
    } catch (e) {
      console.error('Failed to save recurring rule:', e)
      setError(t('保存失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  /** 一键入账提交：按到期窗口逐期落账（漏期时多笔），完成后推进规则 next_date */
  const handlePresetSubmit = async (sanitizedAmount: number) => {
    const preset = recurringPreset!
    setSubmitting(true)
    try {
      for (const dueDate of preset.dueDates) {
        await window.electronAPI.addBill({
          amount: sanitizedAmount,
          category1: form.category1,
          category2: form.category2 || form.category1,
          date: dueDate,
          note: form.note.trim(),
          type: 'expense',
          recurring_id: preset.recurringId,
          payment_platform: preset.paymentPlatform || undefined,
          fund_account: preset.fundAccount || undefined
        })
      }
      await window.electronAPI.updateRecurring(preset.recurringId, { next_date: preset.nextDateAfter })
      await refreshRecurrings()
      addToast('success',
        preset.dueDates.length > 1
          ? t('已补记 {n} 笔周期支出：{name}')
            .replace('{n}', String(preset.dueDates.length))
            .replace('{name}', preset.name)
          : t('已入账周期支出：{name}').replace('{name}', preset.name)
      )
      resetForm()
      closeAddDialog()
      await refreshBills()
      notifyChange()
    } catch (e) {
      console.error('Failed to record recurring bills:', e)
      setError(t('保存失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    setFutureWarning(false)

    // ⚠ 顺序纪律（v2.0.4 修正）：**周期模块必须在单笔校验之前分流**。
    // 此前单笔校验（金额/分类/日期）排在模块分支之前 —— 在周期模块里点保存时，
    // 校验的是那张空的单笔表单，报出来的错误永远不对路（用户感受：「保存不了，也没提示」）。
    if (showModuleSwitch && expenseModule === 'recurring') {
      await handleRecurringSubmit()
      return
    }

    // 第一步：表单校验（v2.0.4：一次性算出全部字段错误，逐字段就地显示 + 聚焦首个问题字段）
    const amount = parseFloat(form.amount)
    const nextFieldErrors: Partial<Record<'amount' | 'category1' | 'category2' | 'date', string>> = {}
    if (isNaN(amount) || amount <= 0) nextFieldErrors.amount = t('请输入有效的金额')
    else if (amount > 99999999.99) nextFieldErrors.amount = t('金额不能超过 99,999,999.99')
    if (!form.category1) nextFieldErrors.category1 = t('请选择一级分类')
    else if (!form.category2 && !isPresetMode) nextFieldErrors.category2 = t('请选择二级分类')
    if (!form.date) nextFieldErrors.date = t('请选择日期')

    const firstInvalid = (['amount', 'category1', 'category2', 'date'] as const).find((k) => nextFieldErrors[k])
    if (firstInvalid) {
      setFieldErrors(nextFieldErrors)
      const focusId = firstInvalid === 'amount' ? 'add-bill-amount' : firstInvalid === 'date' ? 'add-bill-date' : 'add-bill-category-label'
      reportValidationFailure(
        nextFieldErrors,
        nextFieldErrors[firstInvalid] as string,
        focusId,
        firstInvalid === 'category1' || firstInvalid === 'category2' ? '.add-bill-category-select input' : undefined
      )
      return
    }
    setFieldErrors({})

    // 第二步：未来日期确认（允许提交但需用户二次确认；一键入账预填模式跳过）
    const today = formatLocalDate()
    if (!isPresetMode && form.date > today && !futureWarning) {
      setFutureWarning(true)
      setError(t('⚠️ 日期晚于今天 — 确定这是一笔未来支出预登记吗？再次点击"保存"确认。'))
      addToast('info', t('⚠️ 日期晚于今天 — 确定这是一笔未来支出预登记吗？再次点击"保存"确认。'))
      return
    }

    // 金额四舍五入到分（浮点数精度修正，如 0.1+0.2 在 JS 中不等于精确的 0.3）
    const sanitizedAmount = Math.round(amount * 100) / 100

    // 一键入账：逐期落账 + 推进 next_date（金额/分类/备注用表单当前值，日期按期次自动分配）
    if (isPresetMode) {
      await handlePresetSubmit(sanitizedAmount)
      return
    }

    const billData = {
      amount: sanitizedAmount,
      category1: form.category1,
      category2: form.category2,
      date: form.date,
      note: form.note.trim(),
      type: form.type
    }

    setSubmitting(true)
    try {
      if (isEditMode) {
        await window.electronAPI.updateBill(editBillId!, billData)
        addToast('success',
          t('已更新{label}：{cat} ¥{amount}')
            .replace('{label}', typeLabel)
            .replace('{cat}', `${form.category1}·${form.category2}`)
            .replace('{amount}', sanitizedAmount.toFixed(2))
        )
      } else {
        await window.electronAPI.addBill(billData)
        addToast('success',
          t('已记录{label}：{cat} ¥{amount}')
            .replace('{label}', typeLabel)
            .replace('{cat}', `${form.category1}·${form.category2}`)
            .replace('{amount}', sanitizedAmount.toFixed(2))
        )
      }
      resetForm()
      closeAddDialog()
      await refreshBills()
      notifyChange()
    } catch (e) {
      console.error('Failed to save bill:', e)
      setError(t('保存失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  /** 键盘语义：表单负责 Enter 提交，弹窗负责 Escape 关闭和 Tab 循环。 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
      return
    }

    if (e.key === 'Tab') {
      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      const focusable = [
        ...Array.from(e.currentTarget.querySelectorAll<HTMLElement>(focusableSelector)),
        ...Array.from(document.querySelectorAll<HTMLElement>(
          '.add-bill-date-popover button:not([disabled]), .add-bill-date-popover [tabindex]:not([tabindex="-1"])'
        )),
      ].filter((element, index, elements) => elements.indexOf(element) === index)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (!isOpen) return null

  const portalScope = modalPortalScope()

  return createPortal(
    <div
      className={`${portalScope.className} flex items-center justify-center`}
      data-theme={portalScope['data-theme']}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9000 }}
    >
      {/* 半透明背景遮罩，点击关闭 */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={handleClose} aria-hidden="true" />

      {/* 弹窗主体 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-bill-dialog-title"
        aria-describedby={error ? 'add-bill-dialog-error' : undefined}
        tabIndex={-1}
        className="relative rounded-2xl shadow-xl animate-slide-up aurora-dialog add-bill-dialog"
        onKeyDown={handleKeyDown}
      >
        {/* 弹窗标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="add-bill-dialog-title" className="text-lg font-bold text-gray-900">
            {isEditMode ? t('编辑账单') : isPresetMode ? t('周期支出入账') : t('记一笔')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('关闭')}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form className="add-bill-dialog-form" onSubmit={(e) => { e.preventDefault(); if (!submitting) void handleSubmit() }}>
          {/* 表单内容区 */}
          <div className="px-6 py-4 space-y-4 add-bill-dialog-content">
          {/* 支出/收入类型切换（一键入账预填模式固定为支出，隐藏切换） */}
          {!isPresetMode && (
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              type="button"
              aria-pressed={form.type === 'expense'}
              onClick={() => setForm(prev => ({ ...prev, type: 'expense', category1: '', category2: '' }))}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${form.type === 'expense'
                  ? 'bg-white dark:bg-gray-600 text-red-500 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              {t('支出')}
            </button>
            <button
              type="button"
              aria-pressed={form.type === 'income'}
              onClick={() => setForm(prev => ({ ...prev, type: 'income', category1: '', category2: '' }))}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${form.type === 'income'
                  ? 'bg-white dark:bg-gray-600 text-green-500 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              {t('收入')}
            </button>
          </div>
          )}

          {/* v2.0 支出双模块：单笔支出（既有流程）/ 周期支出（登记规则，到期后入账） */}
          {showModuleSwitch && (
            <div role="group" aria-label={t('支出模块')} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                type="button"
                aria-pressed={expenseModule === 'single'}
                onClick={() => setExpenseModule('single')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${expenseModule === 'single'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {t('单笔支出')}
              </button>
              <button
                type="button"
                aria-pressed={expenseModule === 'recurring'}
                onClick={() => setExpenseModule('recurring')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1
                  ${expenseModule === 'recurring'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                <Repeat size={14} aria-hidden="true" />
                {t('周期支出')}
              </button>
            </div>
          )}

          {showModuleSwitch && expenseModule === 'recurring' ? (
            /* 周期支出模块：登记规则（金额/分类/日期等语义见 RecurringFormFields） */
            <RecurringFormFields form={recForm} onChange={patchRecForm} idPrefix="add-bill-rec" errors={recFieldErrors} />
          ) : (
          <>
            {/* 一键入账预填横幅：到期规则 → 按模板入账 */}
            {isPresetMode && recurringPreset && (
              <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700" role="status">
                <Repeat size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {recurringPreset.dueDates.length > 1
                    ? t('{name} 已到期 {n} 期，将按各期日期补记 {n} 笔')
                        .replace('{name}', recurringPreset.name)
                        .replace(/\{n\}/g, String(recurringPreset.dueDates.length))
                    : t('{name} 已到期，确认后按模板入账').replace('{name}', recurringPreset.name)}
                </span>
              </div>
            )}

            {/* 金额输入 */}
            <div>
              <label htmlFor="add-bill-amount" className="block text-sm font-medium text-gray-700 mb-1">{t('金额 (¥)')}</label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium
                  ${form.type === 'income' ? 'text-green-500' : 'text-red-500'}`}>¥</span>
                <input
                  ref={amountInputRef}
                  id="add-bill-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="99999999.99"
                  placeholder="0.00"
                  aria-invalid={fieldErrors.amount ? true : undefined}
                  aria-describedby={fieldErrors.amount ? 'add-bill-amount-error' : undefined}
                  value={form.amount}
                  onChange={(e) => setForm(prev => ({ ...prev, amount: e.target.value }))}
                  className={`input-field pl-8 text-lg font-mono font-medium${fieldErrors.amount ? ' border-red-400' : ''}`}
                />
              </div>
              {fieldErrors.amount && (
                <p id="add-bill-amount-error" role="alert" className="text-xs text-red-500 mt-1">{fieldErrors.amount}</p>
              )}
            </div>

            {/* 分类选择器 */}
            <div>
              <span id="add-bill-category-label" className="block text-sm font-medium text-gray-700 mb-1">{t('分类')}</span>
              <div role="group" aria-labelledby="add-bill-category-label">
                <CategorySelect
                  category1={form.category1}
                  category2={form.category2}
                  type={form.type}
                  onCategory1Change={(cat) => setForm(prev => ({ ...prev, category1: cat, category2: '' }))}
                  onCategory2Change={(cat) => setForm(prev => ({ ...prev, category2: cat }))}
                />
              </div>
              {(fieldErrors.category1 || fieldErrors.category2) && (
                <p id="add-bill-category-error" role="alert" className="text-xs text-red-500 mt-1">
                  {fieldErrors.category1 || fieldErrors.category2}
                </p>
              )}
            </div>

            {/* 日期选择（一键入账模式按期次自动分配，不可改；展示各期日期） */}
            {isPresetMode && recurringPreset ? (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">{t('入账日期')}</span>
                <p className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 font-mono break-words">
                  {recurringPreset.dueDates.join(t('、'))}
                </p>
                {(recurringPreset.paymentPlatform || recurringPreset.fundAccount) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[
                      recurringPreset.paymentPlatform ? t('支付平台') + t('：') + recurringPreset.paymentPlatform : '',
                      recurringPreset.fundAccount ? t('资金账户') + t('：') + recurringPreset.fundAccount : ''
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="add-bill-date" className="block text-sm font-medium text-gray-700 mb-1">{t('日期')}</label>
                <AddBillDatePicker
                  id="add-bill-date"
                  value={form.date}
                  onChange={(date) => setForm(prev => ({ ...prev, date }))}
                />
                {fieldErrors.date && (
                  <p id="add-bill-date-error" role="alert" className="text-xs text-red-500 mt-1">{fieldErrors.date}</p>
                )}
              </div>
            )}

            {/* 备注输入（可选） */}
            <div>
              <label htmlFor="add-bill-note" className="block text-sm font-medium text-gray-700 mb-1">
                {t('备注')} <span className="text-gray-400 font-normal">{t('(可选)')}</span>
              </label>
              <input
                id="add-bill-note"
                type="text"
                maxLength={200}
                placeholder={t('添加备注...')}
                value={form.note}
                onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
                className="input-field"
              />
            </div>
          </>
          )}

          </div>

          {/* 汇总错误/警告固定在按钮上方（**不随内容滚动**）：v2.0.4 前它挂在可滚动内容底部，
              用户没滚到底就看不到，表现为「保存不了但没有任何提示」。 */}
          {error && (
            <div className="px-6 pt-3">
              <p id="add-bill-dialog-error" role="alert" aria-live="assertive" className={`text-sm rounded-lg px-3 py-2 ${
                futureWarning
                  ? 'text-amber-600 bg-amber-50 border border-amber-200'
                  : 'text-red-500 bg-red-50'
              }`}>
                {error}
              </p>
            </div>
          )}

          {/* 底部操作栏：取消 + 保存 */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 add-bill-dialog-footer">
            <button type="button" onClick={handleClose} className="btn-secondary text-sm">
              {t('取消')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary text-sm min-w-[80px]"
            >
              {submitting
                ? t('保存中...')
                : isEditMode
                  ? t('更新')
                  : isPresetMode && recurringPreset && recurringPreset.dueDates.length > 1
                    ? t('补记 {n} 笔').replace('{n}', String(recurringPreset.dueDates.length))
                    : isPresetMode
                      ? t('确认入账')
                      : t('保存')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
