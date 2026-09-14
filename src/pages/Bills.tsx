/**
 * 账单列表页面。
 * 支持：搜索（按分类/备注/金额）、时间段快速筛选（本周/本月/近3月/近6月/近一年）、
 * 分类筛选、支出/收入类型切换。
 * 列表项悬停显示编辑和删除按钮。
 *
 * ── 安卓窄屏（`isAndroid()` 为 true，逻辑宽 <640px）的差异 ──
 * 1. 筛选区默认收起为一行「当前筛选状态」chip（≤52px），点击展开完整面板；
 *    展开面板内仍是先前的 6 个控件与行为（时段/搜索/月份/分类/类型/清除），未删功能。
 * 2. 账单行取消两个常驻 44px 图标按钮（它们把分类名挤到约 45px 后被裁切）：
 *    点整行=编辑，长按整行=删除确认；行尾保留一个可见的删除图标入口
 *    —— 长按删除没有可见线索，必须有一个用户看得见的入口。
 * 3. 汇总行窄屏允许换行（原先无 flex-wrap，超宽会顶出 `.aurora-main` 的整页横向滚动条）。
 * 4. 列表补最小加载态；失败态由 store 的 `billsError` 驱动（`refreshBills` 吞异常但不丢信息），
 *    这样「数据库读取失败」不会再被渲染成「还没有账单记录」。
 * 桌面（`isAndroid()` 为 false）分支的 DOM 与渲染逐位不变：全部新结构都由
 * `isMobileLayout` 门控，桌面分支的 class 字符串与元素顺序与改动前完全一致。
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useStore } from '@/store'
import { Search, Trash2, FilterX, Pencil, Filter, ChevronDown } from 'lucide-react'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subDays } from 'date-fns'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useLanguage } from '@/i18n/LanguageContext'
import { isAndroid } from '@/platform'
import type { Bill } from '@/types'

/** 快速时间段选项 */
type PeriodKey = 'week' | 'month' | '3months' | '6months' | 'year'

/** 长按触发删除确认的阈值（ms） */
const LONG_PRESS_MS = 500

const PERIODS: { key: PeriodKey; calc: () => { start: string; end: string } }[] = [
  { key: 'week', calc: () => {
    const now = new Date()
    return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
  }},
  { key: 'month', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: '3months', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: '6months', calc: () => {
    const now = new Date()
    return { start: format(startOfMonth(subMonths(now, 5)), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  }},
  { key: 'year', calc: () => {
    const now = new Date()
    return { start: format(subDays(now, 365), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') }
  }}
]

interface MobileBillRowProps {
  bill: Bill
  icon: string
  onEdit: (id: number) => void
  onDelete: (bill: Bill) => void
}

/**
 * 安卓窄屏账单行（两点触控交互）：
 * - 点整行 → 编辑；长按整行 → 删除确认（长按后抑制随之而来的 click，避免又弹出编辑）。
 * - 行尾常显一个删除图标按钮作为**可发现的**删除入口；它的触控盒仍是 44×44，
 *   用负外边距把多出来的高度从行高里扣掉（否则 44px 会把行高撑到 70px 以上）。
 */
function MobileBillRow({ bill, icon, onEdit, onDelete }: MobileBillRowProps) {
  const { t } = useLanguage()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const startPress = () => {
    longPressed.current = false // 新手势开始：清掉上一次的抑制标记，避免吞掉本次点击
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      longPressed.current = true
      onDelete(bill)
    }, LONG_PRESS_MS)
  }

  const handleClick = () => {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    onEdit(bill.id)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('编辑')}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit(bill.id)
        }
      }}
      onPointerDown={startPress}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onContextMenu={(e) => e.preventDefault()}
      className="flex items-start gap-2 px-4 py-2 select-none active:bg-[var(--accent-dim)] transition-colors"
    >
      <div className="w-8 h-8 mt-0.5 rounded-lg bg-[var(--bg2)] flex items-center justify-center text-base shrink-0">
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        {/* 分类名独占一行：宽度 = 行内宽 − 图标 32 − gap 8，长名换行而不是被裁掉 */}
        <div className="flex items-center gap-1">
          <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
            {bill.category1} · {bill.category2}
          </span>
          <button
            type="button"
            title={t('删除')}
            aria-label={t('删除')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(bill)
            }}
            className="min-h-11 min-w-11 -my-3 -mr-2 p-2 flex items-center justify-center rounded-lg text-gray-400 active:text-[var(--danger)] shrink-0"
          >
            <Trash2 size={15} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span className="shrink-0">{bill.date}</span>
          {bill.note && (
            <>
              <span className="shrink-0">·</span>
              <span className="truncate min-w-0 flex-1">{bill.note}</span>
            </>
          )}
          <span
            className="text-sm font-semibold shrink-0 ml-auto"
            style={{ color: bill.type === 'income' ? 'var(--success)' : 'var(--danger)' }}
          >
            {bill.type === 'income' ? '+' : '-'}¥{bill.amount.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

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
  const { t } = useLanguage()

  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null)
  const [activePeriod, setActivePeriod] = useState<PeriodKey | null>(null)
  /** 安卓窄屏：筛选面板是否展开（默认收起，渐进披露） */
  const [filtersOpen, setFiltersOpen] = useState(false)
  /**
   * 窄屏列表的加载态。**失败态不在这里** —— 它由 store 的 `billsError` 决定：
   * `refreshBills` 的契约是「吞掉异常 + 把原因记进 state」，它永不 reject，
   * 所以组件内 `try/catch` 设的 error 分支是死代码（本文件曾这样写过，已移除）。
   */
  const [loadState, setLoadState] = useState<'loading' | 'ready'>('loading')

  const isMobileLayout = isAndroid()
  /** 窄屏才渲染加载/失败分支（桌面零变化） */
  const billsError = useStore((s) => s.billsError)
  const hasLoadError = Boolean(billsError)

  /** 快速时间段显示名（中文原文即词典 key，随语言切换） */
  const periodLabels: Record<PeriodKey, string> = {
    week: t('本周'),
    month: t('本月'),
    '3months': t('近3月'),
    '6months': t('近6月'),
    year: t('近一年')
  }

  const load = useCallback(async () => {
    setLoadState('loading')
    // refreshBills 不 reject：失败信息经 store 的 billsError 传出来（见本文件 loadState 注释）
    await refreshBills()
    setLoadState('ready')
  }, [refreshBills])

  // 筛选条件变化时重新从数据库拉取账单
  useEffect(() => {
    void load()
  }, [filterCategory1, filterMonth, filterDateRange, load])

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

  /** 收起态显示的一行筛选摘要（无筛选时为「全部账单」） */
  const filterSummary = (() => {
    const parts: string[] = []
    if (activePeriod) parts.push(periodLabels[activePeriod])
    else if (filterMonth) parts.push(filterMonth)
    if (filterCategory1) parts.push(filterCategory1)
    if (filterType) parts.push(filterType === 'income' ? t('收入') : t('支出'))
    if (search) parts.push(`"${search}"`)
    return parts.length > 0 ? parts.join(' · ') : t('全部账单')
  })()

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
      {/* ── 窄屏：筛选收起态（一行 chip，46px） ── */}
      {isMobileLayout && !filtersOpen && (
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label={t('展开筛选')}
          aria-expanded={false}
          className="card bill-filter-summary w-full flex items-center gap-2 px-4 py-3 text-left"
        >
          <Filter size={15} className="shrink-0 text-gray-400" />
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {filterSummary}
          </span>
          <ChevronDown size={16} className="shrink-0 text-gray-400" />
        </button>
      )}

      {/* ── 筛选栏（桌面常驻；窄屏展开后可见） ── */}
      {(!isMobileLayout || filtersOpen) && (
        <div className="card bill-filter-card bill-filters p-4 space-y-3">
          {isMobileLayout && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-expanded
                className="text-xs font-medium px-2 py-2 -my-2 rounded-md text-gray-500 dark:text-gray-400 active:bg-[var(--accent-dim)]"
              >
                {t('收起')}
              </button>
            </div>
          )}

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
                {periodLabels[p.key]}
              </button>
            ))}
          </div>

          {/* 精确筛选 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[180px]">
              <label htmlFor="bill-search" className="sr-only">
                t('搜索账单')
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
              t('按月份筛选')
            </label>
            <input
              id="bill-month"
              type="month"
              value={filterMonth}
              onChange={(e) => {
                setActivePeriod(null)
                setFilterMonth(e.target.value)
              }}
              className="input-field bill-filter-control bill-filter-date w-auto text-sm"
            />

            {/* 分类筛选 */}
            <label htmlFor="bill-category" className="sr-only">
              t('按分类筛选')
            </label>
            <select
              id="bill-category"
              value={filterCategory1}
              onChange={(e) => setFilterCategory1(e.target.value)}
              className="input-field bill-filter-control bill-filter-select w-auto text-sm min-w-[120px]"
            >
              <option value="">{t('全部分类')}</option>
              {(filterType === 'income' ? incomeCategories : expenseCategories).map((cat) => (
                <option key={cat.name} value={cat.name}>{cat.icon} {cat.name}</option>
              ))}
            </select>

            {/* 类型筛选 */}
            <label htmlFor="bill-type" className="sr-only">
              t('按类型筛选')
            </label>
            <select
              id="bill-type"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as '' | 'expense' | 'income')}
              className="input-field bill-filter-control bill-filter-select w-auto text-sm min-w-[100px]"
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
      )}

      {/* 汇总行（窄屏允许换行，避免顶出整页横向滚动条） */}
      {filtered.length > 0 && (
        <div className={`flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 px-1${isMobileLayout ? ' flex-wrap' : ''}`}>
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
      <div className="card bill-list-card overflow-hidden">
        {isMobileLayout && loadState === 'loading' ? (
          <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('加载中...')}
          </div>
        ) : isMobileLayout && hasLoadError ? (
          <div className="py-12 text-center">
            {/* title 带上 store 记录的原始失败原因，便于排查；不新增可见文案 */}
            <p className="text-sm" style={{ color: 'var(--danger)' }} title={billsError ?? undefined}>
              {t('加载失败，请重试')}
            </p>
            <button type="button" onClick={() => void load()} className="btn-secondary text-sm mt-3">
              {t('重试')}
            </button>
          </div>
        ) : filtered.length === 0 ? (
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
              isMobileLayout ? (
                <MobileBillRow
                  key={bill.id}
                  bill={bill}
                  icon={catIcon(bill.category1)}
                  onEdit={openEditDialog}
                  onDelete={setDeleteTarget}
                />
              ) : (
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
                    className="min-h-11 min-w-11 p-2 rounded-lg text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                    title={t('编辑')}
                  >
                    <Pencil size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeleteTarget(bill)}
                    aria-label={t('删除')}
                    className="min-h-11 min-w-11 p-2 rounded-lg text-gray-400 hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                    title={t('删除')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
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
