import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '@/store'
import { CategorySelect } from './CategorySelect'
import { incomeCategories } from '@/data/incomeCategories'
import type { AddBillForm } from '@/types'

const emptyForm: AddBillForm = {
  amount: '',
  category1: '',
  category2: '',
  date: new Date().toISOString().slice(0, 10),
  note: '',
  type: 'expense'
}

export function AddBillDialog() {
  const isOpen = useStore((s) => s.isAddDialogOpen)
  const editBillId = useStore((s) => s.editBillId)
  const bills = useStore((s) => s.bills)
  const closeAddDialog = useStore((s) => s.closeAddDialog)
  const refreshBills = useStore((s) => s.refreshBills)
  const addToast = useStore((s) => s.addToast)

  const [form, setForm] = useState<AddBillForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [futureWarning, setFutureWarning] = useState(false)

  const isEditMode = editBillId !== null

  // Load existing bill data when editing
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
      ...emptyForm,
      date: new Date().toISOString().slice(0, 10)
    })
    setError('')
    setFutureWarning(false)
  }, [])

  const handleClose = () => {
    resetForm()
    closeAddDialog()
  }

  const handleSubmit = async () => {
    setError('')
    setFutureWarning(false)

    // Validate
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) {
      setError('请输入有效的金额')
      return
    }
    if (amount > 99999999.99) {
      setError('金额不能超过 99,999,999.99')
      return
    }
    if (!form.category1) {
      setError('请选择一级分类')
      return
    }
    if (!form.category2) {
      setError('请选择二级分类')
      return
    }
    if (!form.date) {
      setError('请选择日期')
      return
    }

    // Future date warning (allow but warn)
    const today = new Date().toISOString().slice(0, 10)
    if (form.date > today && !futureWarning) {
      setFutureWarning(true)
      setError('⚠️ 日期晚于今天 — 确定这是一笔未来支出预登记吗？再次点击"保存"确认。')
      return
    }

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
        const editLabel = form.type === 'income' ? '收入' : '支出'
        addToast('success', `已更新${editLabel}：${form.category1}·${form.category2} ¥${sanitizedAmount.toFixed(2)}`)
      } else {
        await window.electronAPI.addBill(billData)
        const label = form.type === 'income' ? '收入' : '支出'
        addToast('success', `已记录${label}：${form.category1}·${form.category2} ¥${sanitizedAmount.toFixed(2)}`)
      }
      resetForm()
      closeAddDialog()
      await refreshBills()
    } catch (e) {
      console.error('Failed to save bill:', e)
      setError('保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={handleClose} />

      {/* Dialog */}
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 animate-slide-up"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEditMode ? '编辑账单' : '记一笔'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Type toggle */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setForm(prev => ({ ...prev, type: 'expense', category1: '', category2: '' }))}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${form.type === 'expense'
                  ? 'bg-white dark:bg-gray-600 text-red-500 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              支出
            </button>
            <button
              onClick={() => setForm(prev => ({ ...prev, type: 'income', category1: '', category2: '' }))}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${form.type === 'income'
                  ? 'bg-white dark:bg-gray-600 text-green-500 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              收入
            </button>
          </div>

          {/* 金额 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">金额 (¥)</label>
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

          {/* 分类 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <CategorySelect
              category1={form.category1}
              category2={form.category2}
              categories={form.type === 'income' ? incomeCategories : undefined}
              onCategory1Change={(cat) => setForm(prev => ({ ...prev, category1: cat, category2: '' }))}
              onCategory2Change={(cat) => setForm(prev => ({ ...prev, category2: cat }))}
            />
          </div>

          {/* 日期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm(prev => ({ ...prev, date: e.target.value }))}
              className="input-field"
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              备注 <span className="text-gray-400 font-normal">(可选)</span>
            </label>
            <input
              type="text"
              maxLength={200}
              placeholder="添加备注..."
              value={form.note}
              onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
              className="input-field"
            />
          </div>

          {/* Error / Warning */}
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={handleClose} className="btn-secondary text-sm">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary text-sm min-w-[80px]"
          >
            {submitting ? '保存中...' : isEditMode ? '更新' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
