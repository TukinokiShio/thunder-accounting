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

  // ── 安卓（P2-3）：编辑模式 + Pointer Events 拖拽 ──
  /** 是否为触屏（安卓）路径。false 时走原有 HTML5 DnD，桌面行为逐位不变 */
  touch: boolean
  /** 安卓编辑模式：仅此模式出现拖动把手与删除按钮 */
  editMode: boolean
  /** 拖动激活中的行下标（长按 ~150ms 后才置位） */
  draggingIdx: number | null
  /** 当前落位目标行下标 */
  dropTargetIdx: number | null
  dragHandleLabel: string
  onHandlePointerDown: (e: React.PointerEvent<HTMLButtonElement>, idx: number) => void
  onHandlePointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void
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
  touch,
  editMode,
  draggingIdx,
  dropTargetIdx,
  dragHandleLabel,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
}: Props) {
  /** 拖动把手/删除按钮是否可见：桌面恒可见（保持原样），安卓仅编辑模式可见 */
  const showReorderAffordances = !touch || editMode

  return (
    <div className="category-list-pane w-56 border-r border-gray-100 flex flex-col shrink-0">
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
        {categories.map((cat, idx) => {
          const isDragging = draggingIdx === idx
          const isDropTarget = dropTargetIdx === idx && draggingIdx !== null && draggingIdx !== idx
          return (
            <div
              key={`${cat.name}-${idx}`}
              data-cat-row="true"
              data-cat-index={idx}
              draggable={!touch}
              onDragStart={touch ? undefined : () => onDragStart(idx)}
              onDragOver={touch ? undefined : (e) => onDragOver(e, idx)}
              onDragEnd={touch ? undefined : onDragEnd}
              onClick={() => onSelect(idx)}
              className={`category-row w-full flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer select-none group
              ${selectedId === idx
                ? 'bg-[var(--accent-dim)] text-[var(--accent-h)] font-medium'
                : 'text-gray-700 hover:bg-gray-50'
              }
              ${isDragging ? 'category-row-dragging' : ''}
              ${isDropTarget ? 'category-row-drop-target' : ''}
            `}
            >
              {touch ? (
                showReorderAffordances && (
                  <button
                    type="button"
                    className="android-drag-handle shrink-0"
                    data-dragging={isDragging ? 'true' : 'false'}
                    aria-label={dragHandleLabel}
                    title={dragHandleLabel}
                    onPointerDown={(e) => onHandlePointerDown(e, idx)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                )
              ) : (
                <span
                  className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GripVertical size={14} />
                </span>
              )}
              <span className="text-lg shrink-0">{cat.icon}</span>
              <span className="truncate flex-1">{cat.name}</span>
              <span className="text-xs text-gray-400 shrink-0 mr-0.5">{cat.children.length}</span>
              {showReorderAffordances && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(idx) }}
                  className="category-delete-btn p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  title={deleteTitle}
                  aria-label={deleteTitle}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}

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
