import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { presetCategories } from '@/data/categories'
import { Search, Trash2, FilterX } from 'lucide-react'
import type { Bill } from '@/types'

export function Bills() {
  const bills = useStore((s) => s.bills)
  const filterCategory1 = useStore((s) => s.filterCategory1)
  const filterMonth = useStore((s) => s.filterMonth)
  const setFilterCategory1 = useStore((s) => s.setFilterCategory1)
  const setFilterMonth = useStore((s) => s.setFilterMonth)
  const refreshBills = useStore((s) => s.refreshBills)

  const [search, setSearch] = useState('')

  // Refresh when filters change
  useEffect(() => {
    refreshBills()
  }, [filterCategory1, filterMonth, refreshBills])

  const filtered = bills.filter((b) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      b.category1.toLowerCase().includes(q) ||
      b.category2.toLowerCase().includes(q) ||
      b.note.toLowerCase().includes(q) ||
      b.amount.toString().includes(q)
    )
  })

  const hasFilters = filterCategory1 || filterMonth
  const clearFilters = () => {
    setFilterCategory1('')
    setFilterMonth('')
    setSearch('')
  }

  const handleDelete = async (bill: Bill) => {
    try {
      await window.electronAPI.deleteBill(bill.id)
      await refreshBills()
    } catch (e) {
      console.error('Failed to delete bill:', e)
    }
  }

  const catIcon = (cat1: string) =>
    presetCategories.find((c) => c.name === cat1)?.icon ?? '📦'

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索账单..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 text-sm"
            />
          </div>

          {/* Month filter */}
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="input-field w-auto text-sm"
          />

          {/* Category filter */}
          <select
            value={filterCategory1}
            onChange={(e) => setFilterCategory1(e.target.value)}
            className="input-field w-auto text-sm min-w-[120px]"
          >
            <option value="">全部分类</option>
            {presetCategories.map((cat) => (
              <option key={cat.name} value={cat.name}>{cat.icon} {cat.name}</option>
            ))}
          </select>

          {/* Clear filters */}
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary text-sm flex items-center gap-1">
              <FilterX size={14} />
              清除
            </button>
          )}
        </div>
      </div>

      {/* Total summary */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
          <span>共 {filtered.length} 条记录</span>
          <span>·</span>
          <span className="text-red-500 font-medium">
            合计 ¥{filtered.reduce((s, b) => s + b.amount, 0).toFixed(2)}
          </span>
        </div>
      )}

      {/* Bill list */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">
              {bills.length === 0 ? '还没有账单记录' : '没有匹配的记录'}
            </p>
            <p className="text-gray-300 text-xs mt-1">
              {bills.length === 0 ? '点击右上角"记一笔"开始记账' : '尝试调整筛选条件'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((bill) => (
              <div
                key={bill.id}
                className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50 transition-colors group"
              >
                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-lg shrink-0">
                  {catIcon(bill.category1)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {bill.category1} · {bill.category2}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                    <span>{bill.date}</span>
                    {bill.note && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[160px]">{bill.note}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <span className="text-sm font-semibold text-red-500 shrink-0">
                  -¥{bill.amount.toFixed(2)}
                </span>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(bill)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
