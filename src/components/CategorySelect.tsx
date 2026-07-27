/**
 * 二级分类联动选择器。
 * 极致简单：内联下拉，用 fixed 定位 + 计算位置 + z-[9999]。
 */
import { useState, useMemo, useRef, useEffect } from 'react'
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

function Dropdown({ triggerRef, open, onClose, children }: { triggerRef: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: React.ReactNode }) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })

    function handle(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || dropRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  if (!open) return null
  return (
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto"
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

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

  return (
    <div className="flex gap-2">
      <button
        ref={trigger1Ref}
        type="button"
        onClick={() => { setOpen1(o => !o); setOpen2(false) }}
        className="input-field flex items-center justify-between text-left flex-1"
      >
        <span className={category1 ? 'text-gray-900' : 'text-gray-400'}>
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
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left
              ${cat.name === category1 ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}
            `}
          >
            <span>{cat.icon}</span>
            {cat.name}
          </button>
        ))}
      </Dropdown>

      <button
        ref={trigger2Ref}
        type="button"
        onClick={() => { if (category1) { setOpen2(o => !o); setOpen1(false) } }}
        disabled={!category1}
        className="input-field flex items-center justify-between text-left flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className={category2 ? 'text-gray-900' : 'text-gray-400'}>
          {category2 || t('选择二级分类')}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open2 ? 'rotate-180' : ''}`} />
      </button>

      <Dropdown triggerRef={trigger2Ref} open={open2} onClose={() => setOpen2(false)}>
        {subCategories.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">先选择一级分类</div>
        ) : subCategories.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { onCategory2Change(name); setOpen2(false) }}
            className={`w-full px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left
              ${name === category2 ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}
            `}
          >
            {name}
          </button>
        ))}
      </Dropdown>
    </div>
  )
}
