import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { useClickOutside } from './useClickOutside'
import type { Category } from '@/types'

interface Props {
  category1: string
  category2: string
  type: 'expense' | 'income'
  onCategory1Change: (cat: string) => void
  onCategory2Change: (cat: string) => void
}

export function CategorySelect({ category1, category2, type, onCategory1Change, onCategory2Change }: Props) {
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const cats: Category[] = type === 'income' ? incomeCategories : expenseCategories

  const [open1, setOpen1] = useState(false)
  const [open2, setOpen2] = useState(false)

  const ref1 = useClickOutside<HTMLDivElement>(() => setOpen1(false), open1)
  const ref2 = useClickOutside<HTMLDivElement>(() => setOpen2(false), open2)

  const selectedCat = useMemo(
    () => cats.find((c) => c.name === category1),
    [category1, cats]
  )

  const subCategories = useMemo(
    () => selectedCat?.children ?? [],
    [selectedCat]
  )

  function selectCat1(name: string) {
    onCategory1Change(name)
    setOpen1(false)
  }

  function selectCat2(name: string) {
    onCategory2Change(name)
    setOpen2(false)
  }

  return (
    <div className="flex gap-2">
      {/* 一级分类 */}
      <div ref={ref1} className="relative flex-1">
        <button
          type="button"
          onClick={() => { setOpen1(!open1); setOpen2(false) }}
          className="input-field flex items-center justify-between text-left"
        >
          <span className={category1 ? 'text-gray-900' : 'text-gray-400'}>
            {category1 ? `${selectedCat?.icon ?? ''} ${category1}` : '选择一级分类'}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open1 ? 'rotate-180' : ''}`} />
        </button>

        {open1 && (
          <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto animate-slide-up">
            {cats.map((cat) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => selectCat1(cat.name)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors
                  ${cat.name === category1 ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}
                `}
              >
                <span>{cat.icon}</span>
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 二级分类 */}
      <div ref={ref2} className="relative flex-1">
        <button
          type="button"
          onClick={() => { if (category1) { setOpen2(!open2); setOpen1(false) } }}
          disabled={!category1}
          className="input-field flex items-center justify-between text-left disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={category2 ? 'text-gray-900' : 'text-gray-400'}>
            {category2 || '选择二级分类'}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open2 ? 'rotate-180' : ''}`} />
        </button>

        {open2 && subCategories.length > 0 && (
          <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto animate-slide-up">
            {subCategories.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectCat2(name)}
                className={`w-full px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left
                  ${name === category2 ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}
                `}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
