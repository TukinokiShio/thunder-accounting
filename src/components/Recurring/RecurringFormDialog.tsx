/**
 * 周期支出规则 新增/编辑 弹窗（v2.0，周期支出页使用）。
 * Portal + 作用域替身（modalScope）——与 AddBillDialog 同一套模态层规范
 * （createPortal 到 document.body + 内联视口几何 + z-index 9000，
 * 由 modal-portal-contract.test.ts 从文件系统派生清单自动纳入契约）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { modalPortalScope } from '@/utils/modalScope'
import { RecurringFormFields, firstRecurringErrorMessage, recurringErrorMap } from './RecurringFormFields'
import { emptyRecurringForm, ruleToForm, validateRecurringForm, formToRecurringParams, type RecurringFormPatch, type RecurringFieldKey } from './recurringFormModel'
import { defaultCategoryFor } from '@/data/recurringOptions'
import type { Recurring, RecurringForm } from '@/types'

interface Props {
  isOpen: boolean
  /** 编辑模式传已有规则；新增模式传 null */
  editing: Recurring | null
  onClose: () => void
}

export function RecurringFormDialog({ isOpen, editing, onClose }: Props) {
  const addRecurringAction = useStore((s) => s.addRecurringAction)
  const updateRecurringAction = useStore((s) => s.updateRecurringAction)
  const notifyChange = useStore((s) => s.notifyChange)
  const addToast = useStore((s) => s.addToast)
  const { t } = useLanguage()

  const [form, setForm] = useState<RecurringForm>(() => emptyRecurringForm())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RecurringFieldKey, string>>>({})
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setForm(editing ? ruleToForm(editing) : emptyRecurringForm())
    setError('')
    setFieldErrors({})
    nameInputRef.current?.focus()
  }, [isOpen, editing])

  const patchForm = (patch: RecurringFormPatch) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      // 切换类型时重置默认分类（订阅→其他杂项 / 定投→金融保险）与交易日标志（定投默认开）
      if (patch.type && patch.type !== prev.type) {
        next.category1 = defaultCategoryFor(patch.type)
        next.trade_day_only = patch.type === 'dca'
      }
      return next
    })
  }

  const handleClose = () => {
    onClose()
  }

  /** v2.0.4：校验失败时把「字段级错误 + 汇总 + toast + 聚焦」一起给出，避免"保存不了但没提示" */
  const reportValidationFailure = (errors: RecurringFieldKey[]) => {
    const map = recurringErrorMap(errors, t)
    const first = firstRecurringErrorMessage(errors, t)
    setFieldErrors(map)
    setError(first)
    addToast('error', first)
    const firstKey = errors[0]
    const idMap: Record<RecurringFieldKey, string> = {
      name: 'recurring-form-name',
      amount: 'recurring-form-amount',
      next_date: 'recurring-form-next-date',
      category1: 'recurring-form-category'
    }
    // 等一帧让错误态渲染出来，再滚动/聚焦到首个问题字段
    setTimeout(() => {
      const el = document.getElementById(idMap[firstKey])
      el?.scrollIntoView({ block: 'center' })
      ;(el as HTMLElement | null)?.focus?.()
    }, 0)
  }

  const handleSubmit = async () => {
    setError('')
    setFieldErrors({})
    const errors = validateRecurringForm(form)
    if (errors.length > 0) {
      reportValidationFailure(errors)
      return
    }

    setSubmitting(true)
    try {
      const params = formToRecurringParams(form)
      if (editing) {
        await updateRecurringAction(editing.id, params)
        addToast('success', t('已更新周期支出：{name}').replace('{name}', params.name))
      } else {
        await addRecurringAction(params)
        addToast('success', t('已添加周期支出：{name}').replace('{name}', params.name))
      }
      notifyChange()
      handleClose()
    } catch (e) {
      console.error('Failed to save recurring rule:', e)
      setError(t('保存失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
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
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={handleClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-form-dialog-title"
        aria-describedby={error ? 'recurring-form-dialog-error' : undefined}
        tabIndex={-1}
        className="relative rounded-2xl shadow-xl animate-slide-up aurora-dialog recurring-form-dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="recurring-form-dialog-title" className="text-lg font-bold text-gray-900">
            {editing ? t('编辑周期支出') : t('新增周期支出')}
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

        <form onSubmit={(e) => { e.preventDefault(); if (!submitting) void handleSubmit() }}>
          <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <RecurringFormFields form={form} onChange={patchForm} idPrefix="recurring-form" errors={fieldErrors} />
          </div>

          {/* 汇总错误固定在按钮上方（**不随内容滚动**）——v2.0.4 前它挂在可滚动内容底部，
              用户没滚到底就看不到，表现为"保存不了但没有任何提示"。 */}
          {error && (
            <div className="px-6 pb-1">
              <p id="recurring-form-dialog-error" role="alert" aria-live="assertive" className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
                {error}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button type="button" onClick={handleClose} className="btn-secondary text-sm">
              {t('取消')}
            </button>
            <button type="submit" disabled={submitting} className="btn-primary text-sm min-w-[80px]">
              {submitting ? t('保存中...') : editing ? t('更新') : t('保存')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
