import { GripVertical, Plus, X } from 'lucide-react'
import type { Category } from '@/types'

interface Props {
  categories: Category[]
  selectedId: number | null
  tab: 'expense' | 'income'
  onTabChange: (tab: 'expense' | 'income') => void
  onSelect: (idx: number) => void
  onNew: () => void
  onDragStart: (idx: number) => void
  onDragOver: (e: React.DragEvent, idx: number) => void
  onDragEnd: () => void
  onDelete: (idx: number) => void
  tabLabelExpense: string
  tabLabelIncome: string
  deleteTitle: string
  newLabel: string
}

export function CategoryList({
  categories,
  selectedId,
  tab,
  onTabChange,
  onSelect,
  onNew,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDelete,
  tabLabelExpense,
  tabLabelIncome,
  deleteTitle,
  newLabel,
}: Props) {
  return (
    <div className="w-56 border-r border-gray-100 flex flex-col shrink-0">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 p-2 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => onTabChange('expense')}
          className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
            ${tab === 'expense'
              ? 'bg-white text-red-500 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          {tabLabelExpense}
        </button>
        <button
          onClick={() => onTabChange('income')}
          className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
            ${tab === 'income'
              ? 'bg-white text-green-500 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          {tabLabelIncome}
        </button>
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {categories.map((cat, idx) => (
          <div
            key={`${cat.name}-${idx}`}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(idx)}
            className={`w-full flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer select-none group
              ${selectedId === idx
                ? 'bg-[var(--accent-dim)] text-[var(--accent-h)] font-medium'
                : 'text-gray-700 hover:bg-gray-50'
              }
            `}
          >
            <span
              className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </span>
            <span className="text-lg shrink-0">{cat.icon}</span>
            <span className="truncate flex-1">{cat.name}</span>
            <span className="text-xs text-gray-400 shrink-0 mr-0.5">{cat.children.length}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(idx) }}
              className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title={deleteTitle}
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {/* Add new button */}
        <button
          onClick={onNew}
          className="category-add-button w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--accent-contrast)] transition-colors mt-1"
        >
          <Plus size={14} />
          {newLabel}
        </button>
      </div>
    </div>
  )
}
