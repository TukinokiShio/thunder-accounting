/**
 * 二级分类联动选择器。
 *
 * 核心修复（v1.7.20）：Dropdown 使用 ReactDOM.createPortal 渲染到 document.body。
 * 这是为了解决 CSS transform（animate-slide-up）创建新 containing block
 * 导致 position:fixed 坐标系错位的经典坑：
 *   - getBoundingClientRect() 始终返回 viewport 坐标
 *   - 但 position:fixed 在 transform 祖先下不再是 viewport 相对
 * → Portal 到 body 后，position:fixed 正确对应 viewport 坐标。
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import type { Category } from '@/types'

interface Props {
  category1: string
  category2: string
  type: 'expense' | 'income'
  onCategory1Change: (cat: string) => void
  onCategory2Change: (cat: string) => void
}

/* ───────── Dropdown（Portal to body）───────── */

function Dropdown({
  triggerRef,
  open,
  onClose,
  children,
}: {
  triggerRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  // Position relative to trigger element (viewport coordinates)
  const recalc = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }, [triggerRef])

  // Recalculate when opened
  useEffect(() => {
    if (!open) return
    recalc()
  }, [open, recalc])

  // Click outside → close, Escape → close, scroll/resize → reposition
  useEffect(() => {
    if (!open) return

    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || dropRef.current?.contains(t)) return
      onClose()
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    // setTimeout(0) prevents the mousedown that opened us from immediately closing us
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)

    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, onClose, recalc, triggerRef])

  if (!open) return null

  return createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 10000 }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto dark:bg-gray-800 dark:border-gray-600"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

/* ───────── CategorySelect ───────── */

export function CategorySelect({ category1, category2, type, onCategory1Change, onCategory2Change }: Props) {
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const cats: Category[] = type === 'income' ? incomeCategories : expenseCategories
  const { t } = useLanguage()

  const [open1, setOpen1] = useState(false)
  const [open2, setOpen2] = useState(false)

  const trigger1Ref = useRef<HTMLButtonElement>(null)
  const trigger2Ref = useRef<HTMLButtonElement>(null)

  const selectedCat = useMemo(() => cats.find((c) => c.name === category1), [category1, cats])
  const subCategories = useMemo(() => selectedCat?.children ?? [], [selectedCat])

  const handleToggle1 = () => {
    setOpen2(false)
    setOpen1((o) => !o)
  }

  const handleToggle2 = () => {
    if (!category1) return
    setOpen1(false)
    setOpen2((o) => !o)
  }

  return (
    <div className="flex gap-2">
      {/* ── 一级分类 ── */}
      <button
        ref={trigger1Ref}
        type="button"
        onClick={handleToggle1}
        className="input-field flex items-center justify-between text-left flex-1"
      >
        <span className={category1 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
          {category1 ? `${selectedCat?.icon ?? ''} ${category1}` : t('选择一级分类')}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open1 ? 'rotate-180' : ''}`} />
      </button>

      <Dropdown triggerRef={trigger1Ref} open={open1} onClose={() => setOpen1(false)}>
        {cats.map((cat) => (
          <button
            key={cat.name}
            type="button"
            onClick={() => { onCategory1Change(cat.name); setOpen1(false) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left
              ${cat.name === category1 ? 'bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/20 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}
            `}
          >
            <span>{cat.icon}</span>
            {cat.name}
          </button>
        ))}
      </Dropdown>

      {/* ── 二级分类 ── */}
      <button
        ref={trigger2Ref}
        type="button"
        onClick={handleToggle2}
        disabled={!category1}
        className="input-field flex items-center justify-between text-left flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className={category2 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
          {category2 || t('选择二级分类')}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open2 ? 'rotate-180' : ''}`} />
      </button>

      <Dropdown triggerRef={trigger2Ref} open={open2} onClose={() => setOpen2(false)}>
        {subCategories.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{t('先选择一级分类')}</div>
        ) : (
          subCategories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => { onCategory2Change(name); setOpen2(false) }}
              className={`w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left
                ${name === category2 ? 'bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/20 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}
              `}
            >
              {name}
            </button>
          ))
        )}
      </Dropdown>
    </div>
  )
}
