/**
 * 首页 / 仪表盘页面。
 * 展示本月统计卡片（今日支出、本月支出、日均、累计、收入、结余）、最近账单列表、支出分类 Top 5。
 * 数据加载分两路：账单列表随月份变化刷新，统计数据额外响应 CRUD 操作通知（refreshTrigger）。
 */
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/store'
import { Wallet, TrendingUp, CalendarDays, List } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { useLanguage } from '@/i18n/LanguageContext'
import type { StatsResult } from '@/types'

export function Home() {
  const bills = useStore((s) => s.bills)
  const refreshBills = useStore((s) => s.refreshBills)
  const refreshTrigger = useStore((s) => s.refreshTrigger)
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
  const [lastMonthTotal, setLastMonthTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const { t } = useLanguage()

  const today = new Date()
  // 本月和上月的起止日期，用于统计数据查询
  const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd')
  const lastMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd')
  const lastMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd')

  /** 并行加载本月支出统计、本月收入统计、上月支出统计（用于环比计算） */
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [expenseStats, incomeStatsResult, lastMonthStats] = await Promise.all([
        window.electronAPI.getStats(monthStart, monthEnd, 'expense'),
        window.electronAPI.getStats(monthStart, monthEnd, 'income'),
        window.electronAPI.getStats(lastMonthStart, lastMonthEnd, 'expense')
      ])
      setStats(expenseStats)
      setIncomeStats(incomeStatsResult)
      setLastMonthTotal(lastMonthStats.totalAmount)
    } catch (e) {
      console.error('Failed to load stats:', e)
    } finally {
      setLoading(false)
    }
  }, [monthStart, monthEnd, lastMonthStart, lastMonthEnd])

  // 账单列表刷新：月份变化时重新拉取（不响应 CRUD 通知，避免与 Home 的 useEffect 形成循环）
  useEffect(() => {
    refreshBills()
  }, [monthStart, monthEnd, refreshBills])

  // 统计数据刷新：月份变化时 + CRUD 操作后（notifyChange 递增 refreshTrigger 触发）
  useEffect(() => {
    loadData()
  }, [monthStart, monthEnd, loadData, refreshTrigger])

  const todayStr = format(today, 'yyyy-MM-dd')
  // 今日支出：筛选今天日期 + 支出类型的账单
  const todayBills = bills.filter((b) => b.date === todayStr && b.type === 'expense')
  const todayTotal = todayBills.reduce((sum, b) => sum + b.amount, 0)

  const monthTotal = stats?.totalAmount ?? 0
  const monthCount = stats?.count ?? 0
  // 日均支出 = 本月总支出 ÷ 本月已过天数（至少为 1，避免除零）
  const avgPerDay = loading ? 0 : monthTotal / Math.max(1, today.getDate())

  // 环比变化率（与上月的对比）
  const momChange = lastMonthTotal > 0
    ? ((monthTotal - lastMonthTotal) / lastMonthTotal * 100)
    : 0

  const incomeTotal = incomeStats?.totalAmount ?? 0
  const balance = incomeTotal - monthTotal

  const statCards = [
    {
      label: t('今日支出'),
      value: `¥${todayTotal.toFixed(2)}`,
      detail: `${todayBills.length} ${t('笔')}`,
      icon: Wallet,
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
    },
    {
      label: t('本月支出'),
      value: `¥${monthTotal.toFixed(2)}`,
      detail: `${monthCount} ${t('笔')}`,
      icon: CalendarDays,
      color: 'text-green-500 bg-green-50 dark:bg-green-900/20'
    },
    {
      label: t('日均支出'),
      value: loading ? '...' : `¥${avgPerDay.toFixed(2)}`,
      detail: `${t('环比')} ${momChange >= 0 ? '+' : ''}${momChange.toFixed(1)}%`,
      icon: TrendingUp,
      color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20'
    },
    {
      label: t('累计记录'),
      value: `${monthCount}`,
      detail: t('本月账单数'),
      icon: List,
      color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20'
    },
    {
      label: t('本月收入'),
      value: loading ? '...' : `¥${incomeTotal.toFixed(2)}`,
      detail: `${incomeStats?.count ?? 0} ${t('笔')}`,
      icon: TrendingUp,
      color: 'text-green-500 bg-green-50 dark:bg-green-900/20'
    },
    {
      label: t('本月结余'),
      value: loading ? '...' : `¥${balance.toFixed(2)}`,
      detail: balance >= 0 ? t('收大于支') : t('支大于收'),
      icon: Wallet,
      color: balance >= 0
        ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
        : 'text-red-500 bg-red-50 dark:bg-red-900/20'
    }
  ]

  const recentBills = bills

  const topCategories = stats?.byCategory2.slice(0, 5) ?? []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="card dark:bg-gray-800 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.color}`}>
                  <Icon size={16} />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{card.label}</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{card.detail}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent bills */}
        <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('最近记录')}</h3>
          {recentBills.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('暂无记录，点击右上角"记一笔"开始记账')}</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {recentBills.map((bill) => (
                <div
                  key={bill.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                      {bill.category1} · {bill.category2}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{bill.date}</p>
                  </div>
                  {bill.type === 'income' ? (
                    <span className="text-sm font-semibold text-green-500 dark:text-green-400 ml-3 shrink-0">
                      +¥{bill.amount.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-red-500 dark:text-red-400 ml-3 shrink-0">
                      -¥{bill.amount.toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top categories */}
        <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('本月支出分类 Top 5')}</h3>
          {topCategories.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('暂无数据')}</p>
          ) : (
            <div className="space-y-3">
              {topCategories.map((cat, idx) => {
                const pct = monthTotal > 0 ? (cat.total / monthTotal * 100) : 0
                return (
                  <div key={`${cat.category1}-${cat.category2}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 dark:text-gray-300">
                        {idx + 1}. {cat.category1} · {cat.category2}
                      </span>
                      <span className="text-gray-900 dark:text-gray-100 font-medium">
                        ¥{cat.total.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cat.count} {t('笔')} · {pct.toFixed(1)}%</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
