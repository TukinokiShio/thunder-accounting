import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/store'
import { Wallet, TrendingUp, CalendarDays, List } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import type { StatsResult } from '@/types'

export function Home() {
  const bills = useStore((s) => s.bills)
  const refreshBills = useStore((s) => s.refreshBills)
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [lastMonthTotal, setLastMonthTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd')
  const lastMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd')
  const lastMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 并行请求本月统计 + 上月统计 + 刷新账单
      const [thisMonthStats, lastMonthStats] = await Promise.all([
        window.electronAPI.getStats(monthStart, monthEnd),
        window.electronAPI.getStats(lastMonthStart, lastMonthEnd)
      ])
      setStats(thisMonthStats)
      setLastMonthTotal(lastMonthStats.totalAmount)
      await refreshBills()
    } catch (e) {
      console.error('Failed to load stats:', e)
    } finally {
      setLoading(false)
    }
  }, [monthStart, monthEnd, lastMonthStart, lastMonthEnd, refreshBills])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 今日支出
  const todayStr = format(today, 'yyyy-MM-dd')
  const todayBills = bills.filter((b) => b.date === todayStr)
  const todayTotal = todayBills.reduce((sum, b) => sum + b.amount, 0)

  const monthTotal = stats?.totalAmount ?? 0
  const monthCount = stats?.count ?? 0
  const avgPerDay = loading ? 0 : monthTotal / Math.max(1, today.getDate())

  const momChange = lastMonthTotal > 0
    ? ((monthTotal - lastMonthTotal) / lastMonthTotal * 100)
    : 0

  const statCards = [
    {
      label: '今日支出',
      value: `¥${todayTotal.toFixed(2)}`,
      detail: `${todayBills.length} 笔`,
      icon: Wallet,
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
    },
    {
      label: '本月支出',
      value: `¥${monthTotal.toFixed(2)}`,
      detail: `${monthCount} 笔`,
      icon: CalendarDays,
      color: 'text-green-500 bg-green-50 dark:bg-green-900/20'
    },
    {
      label: '日均支出',
      value: loading ? '...' : `¥${avgPerDay.toFixed(2)}`,
      detail: `环比 ${momChange >= 0 ? '+' : ''}${momChange.toFixed(1)}%`,
      icon: TrendingUp,
      color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20'
    },
    {
      label: '累计记录',
      value: `${monthCount}`,
      detail: '本月账单数',
      icon: List,
      color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20'
    }
  ]

  // Recent bills (top 5)
  const recentBills = bills.slice(0, 5)

  // Top categories this month
  const topCategories = stats?.byCategory1.slice(0, 5) ?? []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">最近记录</h3>
          {recentBills.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">暂无记录，点击右上角"记一笔"开始记账</p>
          ) : (
            <div className="space-y-2">
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
                  <span className="text-sm font-semibold text-red-500 dark:text-red-400 ml-3 shrink-0">
                    -¥{bill.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top categories */}
        <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">本月支出分类 Top 5</h3>
          {topCategories.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {topCategories.map((cat, idx) => {
                const pct = monthTotal > 0 ? (cat.total / monthTotal * 100) : 0
                return (
                  <div key={cat.category1}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 dark:text-gray-300">
                        {idx + 1}. {cat.category1}
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
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cat.count} 笔 · {pct.toFixed(1)}%</p>
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
