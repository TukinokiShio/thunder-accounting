import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid
} from 'recharts'
import { Download, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import type { StatsResult } from '@/types'

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#64748b', '#84cc16'
]

export function Stats() {
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | 'last3Months'>('thisMonth')
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const addToast = useStore((s) => s.addToast)

  const now = new Date()

  const dateRange = (() => {
    switch (period) {
      case 'thisMonth':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
          label: format(now, 'yyyy年M月')
        }
      case 'lastMonth': {
        const lm = subMonths(now, 1)
        return {
          start: format(startOfMonth(lm), 'yyyy-MM-dd'),
          end: format(endOfMonth(lm), 'yyyy-MM-dd'),
          label: format(lm, 'yyyy年M月')
        }
      }
      case 'last3Months': {
        const lm3 = subMonths(now, 2)
        return {
          start: format(startOfMonth(lm3), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
          label: `近3个月`
        }
      }
    }
  })()

  useEffect(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      window.electronAPI.getStats(dateRange.start, dateRange.end, 'expense'),
      window.electronAPI.getStats(dateRange.start, dateRange.end, 'income')
    ])
      .then(([exp, inc]) => { setStats(exp); setIncomeStats(inc); setError(false) })
      .catch((e) => { console.error(e); setError(true) })
      .finally(() => setLoading(false))
  }, [dateRange.start, dateRange.end])

  const handleExport = async () => {
    try {
      const csv = await window.electronAPI.exportCSV({
        startDate: dateRange.start,
        endDate: dateRange.end
      })
      const filePath = await window.electronAPI.showSaveDialog(
        `雷霆记账_导出_${dateRange.start}_${dateRange.end}.csv`
      )
      if (filePath) {
        await window.electronAPI.writeFile(filePath, csv)
        addToast('success', 'CSV 文件已导出')
      }
    } catch (e) {
      console.error('Export failed:', e)
      addToast('error', '导出失败，请重试')
    }
  }

  const pieData = stats?.byCategory1.map((c) => ({
    name: c.category1,
    value: c.total
  })) ?? []

  const lineData = stats?.byDate.map((d) => ({
    date: d.date.slice(5), // MM-DD
    amount: d.total
  })) ?? []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Period selector + export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {([
            ['thisMonth', '本月'],
            ['lastMonth', '上月'],
            ['last3Months', '近3个月']
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${period === key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        <button onClick={handleExport} className="btn-secondary dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 text-sm flex items-center gap-1.5">
          <Download size={14} />
          导出 CSV
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-500 dark:text-gray-400">统计数据加载失败</p>
          <button
            onClick={() => {
              Promise.all([
                window.electronAPI.getStats(dateRange.start, dateRange.end, 'expense'),
                window.electronAPI.getStats(dateRange.start, dateRange.end, 'income')
              ])
                .then(([exp, inc]) => { setStats(exp); setIncomeStats(inc) })
                .catch(console.error)
                .finally(() => setLoading(false))
            }}
            className="mt-3 text-sm text-primary-500 hover:text-primary-600 font-medium"
          >
            点击重试
          </button>
        </div>
      ) : (!stats || stats.count === 0) && (!incomeStats || incomeStats.count === 0) ? (
        <div className="card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <p className="text-gray-400 dark:text-gray-500">该时间段暂无数据</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">总支出</p>
              <p className="text-xl font-bold text-red-500">¥{stats.totalAmount.toFixed(2)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">总收入</p>
              <p className="text-xl font-bold text-green-500">¥{(incomeStats?.totalAmount ?? 0).toFixed(2)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">总笔数</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.count + (incomeStats?.count ?? 0)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">结余</p>
              <p className={`text-xl font-bold ${(incomeStats?.totalAmount ?? 0) - stats.totalAmount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ¥{((incomeStats?.totalAmount ?? 0) - stats.totalAmount).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie chart - category breakdown */}
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">支出分类占比</h3>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* Donut chart */}
                <div className="w-[200px] h-[200px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        innerRadius={55}
                        strokeWidth={0}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => [`¥${value.toFixed(2)}`, '金额']}
                        labelFormatter={(name: string) => name}
                        contentStyle={{
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb',
                          fontSize: '13px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Custom legend */}
                <div className="flex-1 min-w-0 space-y-1.5 max-h-[200px] overflow-auto">
                  {pieData.map((item, idx) => {
                    const pct = stats.totalAmount > 0
                      ? (item.value / stats.totalAmount * 100).toFixed(1)
                      : '0'
                    return (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0">{item.name}</span>
                        <span className="text-gray-400 dark:text-gray-500 shrink-0">{pct}%</span>
                        <span className="text-gray-900 dark:text-gray-100 font-medium shrink-0 w-[72px] text-right">
                          ¥{item.value.toFixed(2)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Line chart - daily trend */}
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">每日支出趋势</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={{ stroke: '#4b5563' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `¥${v}`}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '支出']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      fontSize: '13px',
                      backgroundColor: '#1f2937',
                      color: '#f9fafb'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    name="支出金额"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Category detail table */}
          <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">分类明细</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">一级分类</th>
                    <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">二级分类</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">笔数</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">金额</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byCategory2.map((row, idx) => (
                    <tr key={idx} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors">
                      <td className="py-2 px-3 text-gray-900 dark:text-gray-200">{row.category1}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-400">{row.category2}</td>
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{row.count}</td>
                      <td className="py-2 px-3 text-right text-gray-900 dark:text-gray-200 font-medium">
                        ¥{row.total.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-400 dark:text-gray-500">
                        {stats.totalAmount > 0
                          ? (row.total / stats.totalAmount * 100).toFixed(1) + '%'
                          : '-'
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
