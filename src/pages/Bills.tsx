/**
 * 账单列表页面。
 * 支持：搜索（按分类/备注/金额）、时间段快速筛选（本周/本月/近3月/近6月/近一年）、
 * 分类筛选、支出/收入类型切换。
 * 列表项悬停显示编辑和删除按钮。
 */
import { useEffect, useState, useMemo } from 'react'
import { useStore } from '@/store'
import { Search, Trash2, FilterX, Pencil } from 'lucide-react'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subDays } from 'date-fns'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useLanguage } from '@/i18n/LanguageContext'
import type { Bill } from '@/types'

/** 快速时间段选项 */
type PeriodKey = 'week' | 'month' | '3months' | '6months' | 'year'

const PERIODS: { key: PeriodKey; labelKey: string; calc: () => { start: string; end: string } }[] = [
  { key: 'week', labelKey: '本周', calc: () => {
    const now = new Date()
    return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
  }},
  { key: 'month', labelKey: '本月', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: '3months', labelKey: '近3月', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: '6months', labelKey: '近6月', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(subMonths(now, 5)), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: 'year', labelKey: '近一年', calc: () => {
    const now = new Date()
    return { start: format(subDays(now, 365), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') }
  }}
]

export function Bills() {
  const bills = useStore((s) => s.bills)
  const filterCategory1 = useStore((s) => s.filterCategory1)
  const filterMonth = useStore((s) => s.filterMonth)
  const filterDateRange = useStore((s) => s.filterDateRange)
  const filterType = useStore((s) => s.filterType)
  const setFilterCategory1 = useStore((s) => s.setFilterCategory1)
  const setFilterMonth = useStore((s) => s.setFilterMonth)
  const setFilterDateRange = useStore((s) => s.setFilterDateRange)
  const setFilterType = useStore((s) => s.setFilterType)
  const refreshBills = useStore((s) => s.refreshBills)
  const notifyChange = useStore((s) => s.notifyChange)
  const openEditDialog = useStore((s) => s.openEditDialog)
  const addToast = useStore((s) => s.addToast)
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const { t, language } = useLanguage()

  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null)
  const [activePeriod, setActivePeriod] = useState<PeriodKey | null>(null)

  // 筛选条件变化时重新从数据库拉取账单
  useEffect(() => {
    refreshBills()
  }, [filterCategory1, filterMonth, filterDateRange, refreshBills])

  /** 点击快速时间段按钮 */
  const handlePeriodClick = (p: PeriodKey) => {
    if (activePeriod === p) {
      // 再次点击取消选择
      setActivePeriod(null)
      setFilterDateRange(null)
    } else {
      setActivePeriod(p)
      const period = PERIODS.find(pp => pp.key === p)
      if (period) {
        setFilterDateRange(period.calc())
      }
    }
  }

  /** 前端搜索过滤 */
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

  const hasFilters = Boolean(search || filterCategory1 || filterMonth || filterDateRange || filterType)
  const clearFilters = () => {
    setFilterCategory1('')
    setFilterMonth('')
    setFilterDateRange(null)
    setFilterType('')
    setSearch('')
    setActivePeriod(null)
  }

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
    <div className="page-view space-y-4">
      {/* ── 筛选栏 ── */}
      <div className="card bill-filters p-4 space-y-3">
        {/* 快速时间段 */}
        <div className="bill-filter-periods flex items-center gap-1 rounded-lg p-1 w-fit">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => handlePeriodClick(p.key)}
              type="button"
              aria-pressed={activePeriod === p.key}
              className={`bill-filter-period px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activePeriod === p.key
                  ? 'is-active'
                  : ''
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        {/* 精确筛选 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[180px]">
            <label htmlFor="bill-search" className="sr-only">
              {language === 'zh' ? '搜索账单' : 'Search bills'}
            </label>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              id="bill-search"
              type="text"
              placeholder={t('搜索账单...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field bill-filter-control pl-8 text-sm"
            />
          </div>

          {/* 月份筛选（精确到月） */}
          <label htmlFor="bill-month" className="sr-only">
            {language === 'zh' ? '按月份筛选' : 'Filter by month'}
          </label>
          <input
            id="bill-month"
            type="month"
            value={filterMonth}
            onChange={(e) => {
              setActivePeriod(null)
              setFilterMonth(e.target.value)
            }}
            className="input-field bill-filter-control w-auto text-sm"
          />

          {/* 分类筛选 */}
          <label htmlFor="bill-category" className="sr-only">
            {language === 'zh' ? '按分类筛选' : 'Filter by category'}
          </label>
          <select
            id="bill-category"
            value={filterCategory1}
            onChange={(e) => setFilterCategory1(e.target.value)}
            className="input-field bill-filter-control w-auto text-sm min-w-[120px]"
          >
            <option value="">{t('全部分类')}</option>
            {(filterType === 'income' ? incomeCategories : expenseCategories).map((cat) => (
              <option key={cat.name} value={cat.name}>{cat.icon} {cat.name}</option>
            ))}
          </select>

          {/* 类型筛选 */}
          <label htmlFor="bill-type" className="sr-only">
            {language === 'zh' ? '按类型筛选' : 'Filter by type'}
          </label>
          <select
            id="bill-type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as '' | 'expense' | 'income')}
            className="input-field bill-filter-control w-auto text-sm min-w-[100px]"
          >
            <option value="">{t('全部类型')}</option>
            <option value="expense">{t('支出')}</option>
            <option value="income">{t('收入')}</option>
          </select>

          {/* 清除筛选 */}
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary text-sm flex items-center gap-1">
              <FilterX size={14} />
              {t('清除')}
            </button>
          )}
        </div>
      </div>

      {/* 汇总行 */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 px-1">
          <span>{t('共 {n} 条记录').replace('{n}', String(filtered.length))}</span>
          <span>·</span>
          <span className="font-medium" style={{ color: 'var(--danger)' }}>
            {t('支出合计')} ¥{filtered.filter(b => b.type === 'expense').reduce((s, b) => s + b.amount, 0).toFixed(2)}
          </span>
          {filtered.some(b => b.type === 'income') && (
            <>
              <span>·</span>
              <span className="font-medium" style={{ color: 'var(--success)' }}>
                {t('收入合计')} ¥{filtered.filter(b => b.type === 'income').reduce((s, b) => s + b.amount, 0).toFixed(2)}
              </span>
            </>
          )}
        </div>
      )}

      {/* 账单列表 */}
      <div className="card overflow-hidden">
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
                className="flex items-center gap-4 px-5 py-3 hover:bg-[var(--accent-dim)] transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--bg2)] flex items-center justify-center text-lg shrink-0">
                  {catIcon(bill.category1)}
                </div>

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

                <span
                  className="text-sm font-semibold shrink-0"
                  style={{ color: bill.type === 'income' ? 'var(--success)' : 'var(--danger)' }}
                >
                  {bill.type === 'income' ? '+' : '-'}¥{bill.amount.toFixed(2)}
                </span>

                <button
                  type="button"
                  onClick={() => openEditDialog(bill.id)}
                  aria-label={t('编辑')}
                  className="min-h-11 min-w-11 p-2 rounded-lg text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={t('编辑')}
                >
                  <Pencil size={14} />
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteTarget(bill)}
                  aria-label={t('删除')}
                  className="min-h-11 min-w-11 p-2 rounded-lg text-gray-400 hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={t('删除')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
