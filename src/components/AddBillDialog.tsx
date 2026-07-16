import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { formatLocalDate } from '@/utils/date'
import { CategorySelect } from './CategorySelect'
import type { AddBillForm } from '@/types'

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
  const closeAddDialog = useStore((s) => s.closeAddDialog)
  const refreshBills = useStore((s) => s.refreshBills)
  const addToast = useStore((s) => s.addToast)
  const notifyChange = useStore((s) => s.notifyChange)
  const { t } = useLanguage()

  const [form, setForm] = useState<AddBillForm>(getEmptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [futureWarning, setFutureWarning] = useState(false)

  const isEditMode = editBillId !== null

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

  const resetForm = useCallback(() => {
    setForm({
      ...getEmptyForm(),
      date: formatLocalDate()
    })
    setError('')
    setFutureWarning(false)
  }, [])

  const typeLabel = form.type === 'income' ? t('收入') : t('支出')

  const handleClose = () => {
    resetForm()
    closeAddDialog()
  }

  const handleSubmit = async () => {
    setError('')
    setFutureWarning(false)

    // 第一步：表单校验
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) {
      setError(t('请输入有效的金额'))
      return
    }
    if (amount > 99999999.99) {
      setError(t('金额不能超过 99,999,999.99'))
      return
    }
    if (!form.category1) {
      setError(t('请选择一级分类'))
      return
    }
    if (!form.category2) {
      setError(t('请选择二级分类'))
      return
    }
    if (!form.date) {
      setError(t('请选择日期'))
      return
    }

    // 第二步：未来日期确认（允许提交但需用户二次确认）
    const today = formatLocalDate()
    if (form.date > today && !futureWarning) {
      setFutureWarning(true)
      setError(t('⚠️ 日期晚于今天 — 确定这是一笔未来支出预登记吗？再次点击"保存"确认。'))
      return
    }

    // 金额四舍五入到分（浮点数精度修正，如 0.1+0.2 在 JS 中不等于精确的 0.3）
    const sanitizedAmount = Math.round(amount * 100) / 100
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

  /** 键盘快捷键：Enter 提交表单，Escape 关闭弹窗 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting) {
      handleSubmit()
    }
    if (e.key === 'Escape') {
      handleClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 半透明背景遮罩，点击关闭 */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={handleClose} />

      {/* 弹窗主体 */}
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 animate-slide-up"
        onKeyDown={handleKeyDown}
      >
        {/* 弹窗标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEditMode ? t('编辑账单') : t('记一笔')}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单内容区 */}
        <div className="px-6 py-4 space-y-4">
          {/* 支出/收入类型切换 */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
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

          {/* 金额输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('金额 (¥)')}</label>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium
                ${form.type === 'income' ? 'text-green-500' : 'text-red-500'}`}>¥</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="99999999.99"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm(prev => ({ ...prev, amount: e.target.value }))}
                className="input-field pl-8 text-lg font-mono font-medium"
                autoFocus
              />
            </div>
          </div>

          {/* 分类选择器 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('分类')}</label>
            <CategorySelect
              category1={form.category1}
              category2={form.category2}
              type={form.type}
              onCategory1Change={(cat) => setForm(prev => ({ ...prev, category1: cat, category2: '' }))}
              onCategory2Change={(cat) => setForm(prev => ({ ...prev, category2: cat }))}
            />
          </div>

          {/* 日期选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('日期')}</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm(prev => ({ ...prev, date: e.target.value }))}
              className="input-field"
            />
          </div>

          {/* 备注输入（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('备注')} <span className="text-gray-400 font-normal">{t('(可选)')}</span>
            </label>
            <input
              type="text"
              maxLength={200}
              placeholder={t('添加备注...')}
              value={form.note}
              onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
              className="input-field"
            />
          </div>

          {/* 错误提示 / 警告信息 */}
          {error && (
            <p className={`text-sm rounded-lg px-3 py-2 ${
              futureWarning
                ? 'text-amber-600 bg-amber-50 border border-amber-200'
                : 'text-red-500 bg-red-50'
            }`}>
              {error}
            </p>
          )}
        </div>

        {/* 底部操作栏：取消 + 保存 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={handleClose} className="btn-secondary text-sm">
            {t('取消')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary text-sm min-w-[80px]"
          >
            {submitting ? t('保存中...') : isEditMode ? t('更新') : t('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}
