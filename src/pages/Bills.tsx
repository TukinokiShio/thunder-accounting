/**
 * 账单列表页面。
 * 支持：搜索（按分类/备注/金额）、月份筛选、分类筛选、支出/收入类型切换。
 * 列表项悬停显示编辑和删除按钮。
 */
import { useEffect, useState, useMemo } from 'react'
import { useStore } from '@/store'
import { Search, Trash2, FilterX, Pencil } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useLanguage } from '@/i18n/LanguageContext'
import type { Bill } from '@/types'

export function Bills() {
  const bills = useStore((s) => s.bills)
  const filterCategory1 = useStore((s) => s.filterCategory1)
  const filterMonth = useStore((s) => s.filterMonth)
  const filterType = useStore((s) => s.filterType)
  const setFilterCategory1 = useStore((s) => s.setFilterCategory1)
  const setFilterMonth = useStore((s) => s.setFilterMonth)
  const setFilterType = useStore((s) => s.setFilterType)
  const refreshBills = useStore((s) => s.refreshBills)
  const notifyChange = useStore((s) => s.notifyChange)
  const openEditDialog = useStore((s) => s.openEditDialog)
  const addToast = useStore((s) => s.addToast)
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const { t } = useLanguage()

  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null)

  // 筛选条件变化时重新从数据库拉取账单
  useEffect(() => {
    refreshBills()
  }, [filterCategory1, filterMonth, refreshBills])

  /** 前端搜索过滤：在分类名、备注、金额中模糊匹配用户输入的关键词，再叠加类型筛选 */
  const filtered = bills.filter((b) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      b.category1.toLowerCase().includes(q) ||
      b.category2.toLowerCase().includes(q) ||
      b.note.toLowerCase().includes(q) ||
      b.amount.toString().includes(q)
    )
  }).filter((b) => {
    if (!filterType) return true
    return b.type === filterType
  })

  const hasFilters = filterCategory1 || filterMonth || filterType
  const clearFilters = () => {
    setFilterCategory1('')
    setFilterMonth('')
    setFilterType('')
    setSearch('')
  }

  /** 确认删除账单，调用主进程 IPC 后刷新列表并通知首页更新统计 */
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      await window.electronAPI.deleteBill(deleteTarget.id)
      const sign = deleteTarget.type === 'income' ? '+' : '-'
      addToast('success', t('已删除：{desc}').replace('{desc}',
        `${deleteTarget.category1}·${deleteTarget.category2} ${sign}¥${deleteTarget.amount.toFixed(2)}`))
      setDeleteTarget(null)
      await refreshBills()
      notifyChange()
    } catch (e) {
      console.error('Failed to delete bill:', e)
      addToast('error', t('删除失败，请重试'))
    }
  }

  const allCategories = useMemo(() =>
    [...expenseCategories, ...incomeCategories],
    [expenseCategories, incomeCategories]
  )

  const catIcon = (cat1: string) =>
    allCategories.find((c) => c.name === cat1)?.icon ?? '📦'

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* ── 筛选栏：搜索 + 月份 + 分类 + 类型 ── */}
      <div className="card dark:bg-gray-800 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('搜索账单...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 pl-8 text-sm"
            />
          </div>

          {/* 月份筛选 */}
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="input-field dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 w-auto text-sm"
          />

          {/* 分类筛选 */}
          <select
            value={filterCategory1}
            onChange={(e) => setFilterCategory1(e.target.value)}
            className="input-field dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 w-auto text-sm min-w-[120px]"
          >
            <option value="">{t('全部分类')}</option>
            {(filterType === 'income' ? incomeCategories : expenseCategories).map((cat) => (
              <option key={cat.name} value={cat.name}>{cat.icon} {cat.name}</option>
            ))}
          </select>

          {/* 类型筛选（支出/收入） */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as '' | 'expense' | 'income')}
            className="input-field dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 w-auto text-sm min-w-[100px]"
          >
            <option value="">{t('全部类型')}</option>
            <option value="expense">{t('支出')}</option>
            <option value="income">{t('收入')}</option>
          </select>

          {/* 清除所有筛选条件 */}
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 text-sm flex items-center gap-1">
              <FilterX size={14} />
              {t('清除')}
            </button>
          )}
        </div>
      </div>

      {/* 汇总行：总条数 + 支出合计 + 收入合计 */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 px-1">
          <span>{t('共 {n} 条记录').replace('{n}', String(filtered.length))}</span>
          <span>·</span>
          <span className="text-red-500 dark:text-red-400 font-medium">
            {t('支出合计')} ¥{filtered.filter(b => b.type === 'expense').reduce((s, b) => s + b.amount, 0).toFixed(2)}
          </span>
          {filtered.some(b => b.type === 'income') && (
            <>
              <span>·</span>
              <span className="text-green-500 dark:text-green-400 font-medium">
                {t('收入合计')} ¥{filtered.filter(b => b.type === 'income').reduce((s, b) => s + b.amount, 0).toFixed(2)}
              </span>
            </>
          )}
        </div>
      )}

      {/* 账单列表 */}
      <div className="card dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 dark:text-gray-500 text-sm">
              {bills.length === 0 ? t('还没有账单记录') : t('没有匹配的记录')}
            </p>
            <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">
              {bills.length === 0 ? t('点击右上角"记一笔"开始记账') : t('尝试调整筛选条件')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {filtered.map((bill) => (
              <div
                key={bill.id}
                className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors group"
              >
                {/* 分类图标 */}
                <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-lg shrink-0">
                  {catIcon(bill.category1)}
                </div>

                {/* 分类名 + 日期 + 备注 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {bill.category1} · {bill.category2}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    <span>{bill.date}</span>
                    {bill.note && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[160px]">{bill.note}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* 金额（红色支出 / 绿色收入） */}
                <span className={`text-sm font-semibold shrink-0 ${
                  bill.type === 'income'
                    ? 'text-green-500 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400'
                }`}>
                  {bill.type === 'income' ? '+' : '-'}¥{bill.amount.toFixed(2)}
                </span>

                {/* 编辑按钮（悬停显示） */}
                <button
                  onClick={() => openEditDialog(bill.id)}
                  className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 opacity-0 group-hover:opacity-100 transition-all"
                  title={t('编辑')}
                >
                  <Pencil size={14} />
                </button>

                {/* 删除按钮（悬停显示） */}
                <button
                  onClick={() => setDeleteTarget(bill)}
                  className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                  title={t('删除')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('确认删除')}
        message={deleteTarget
          ? t('确定要删除这条记录吗？删除后不可恢复。')
          : ''
        }
        confirmLabel={t('删除')}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
