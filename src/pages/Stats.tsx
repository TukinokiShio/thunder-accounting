/**
 * 统计概览页面。
 * 展示支出/收入汇总卡片、支出分类环形图（一级 + 二级下钻）、每日支出趋势折线图、分类明细表。
 * 支持本月 / 上月 / 近3个月三个时间粒度切换，以及 CSV 导出。
 */
import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid
} from 'recharts'
import { Download, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import type { StatsResult } from '@/types'

// 饼图/环形图配色方案（10 色，从 Tailwind 色板选取，相邻色视觉区分度足够）
const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#64748b', '#84cc16'
]

/** Recharts Pie 组件的 label render prop 参数 */
interface PieLabelProps {
  cx: number
  cy: number
  midAngle: number
  innerRadius: number
  outerRadius: number
  name: string
  percent: number
  index: number
}

// 角度 → 弧度转换系数，用于环形图标签的三角函数定位计算
const RADIAN = Math.PI / 180

/**
 * 环形图环外标签渲染函数（Recharts Pie 的 label prop）。
 * 通过三角函数将标签定位到环外 35px 处，显示分类名称和百分比。
 * 标签水平位置以圆心为基准：x > cx 时右对齐，否则左对齐，避免文字重叠。
 */
const renderLabel = ({ cx, cy, midAngle, outerRadius, name, percent }: PieLabelProps) => {
  const radius = outerRadius + 35
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  const textAnchor = x > cx ? 'start' : 'end'

  return (
    <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central"
      className="text-xs fill-gray-700 dark:fill-gray-300"
    >
      {name} {(percent * 100).toFixed(0)}%
    </text>
  )
}

/** 统计页面主组件。数据加载采用 Promise.all 并行查询支出和收入统计。 */
export function Stats() {
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | 'last3Months'>('thisMonth')
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const addToast = useStore((s) => s.addToast)
  const { t, language } = useLanguage()

  const now = new Date()

  // 根据选中的时间粒度（本月/上月/近3个月）计算起止日期和显示标签
  const dateRange = (() => {
    switch (period) {
      case 'thisMonth':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
          label: language === 'zh' ? format(now, 'yyyy年M月') : format(now, 'MMM yyyy')
        }
      case 'lastMonth': {
        const lm = subMonths(now, 1)
        return {
          start: format(startOfMonth(lm), 'yyyy-MM-dd'),
          end: format(endOfMonth(lm), 'yyyy-MM-dd'),
          label: language === 'zh' ? format(lm, 'yyyy年M月') : format(lm, 'MMM yyyy')
        }
      }
      case 'last3Months': {
        const lm3 = subMonths(now, 2)
        return {
          start: format(startOfMonth(lm3), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
          label: t('近3个月')
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

  /** CSV 导出流程：查询数据 → 弹出保存对话框 → 写入文件 → 提示成功 */
  const handleExport = async () => {
    try {
      const csv = await window.electronAPI.exportCSV({
        startDate: dateRange.start,
        endDate: dateRange.end
      })
      const filePath = await window.electronAPI.showSaveDialog(
        `ThunderBooks_Export_${dateRange.start}_${dateRange.end}.csv`
      )
      if (filePath) {
        await window.electronAPI.writeFile(filePath, csv)
        addToast('success', t('CSV 文件已导出'))
      }
    } catch (e) {
      console.error('Export failed:', e)
      addToast('error', t('导出失败，请重试'))
    }
  }

  // 一级分类 → 环形图数据（名称 + 金额）
  const pieData = stats?.byCategory1.map((c) => ({
    name: c.category1,
    value: c.total
  })) ?? []

  // 每日汇总 → 折线图数据（X 轴取 MM-DD，避免年份占空间）
  const lineData = stats?.byDate.map((d) => ({
    date: d.date.slice(5), // 截取月-日部分（如 "01-15"），省去年份
    amount: d.total
  })) ?? []

  // 金额最高的一级分类，用于二级分类环形图下钻
  const topCategory1 = stats?.byCategory1[0]?.category1 ?? null

  // 排名第一的一级分类下的二级分类明细 → 第二个环形图数据
  const subPieData = topCategory1
    ? stats.byCategory2
        .filter((c) => c.category1 === topCategory1)
        .map((c) => ({ name: c.category2, value: c.total }))
    : []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── 时间粒度选择器 + CSV 导出按钮 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {([
            ['thisMonth', t('本月')],
            ['lastMonth', t('上月')],
            ['last3Months', t('近3个月')]
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
          {t('导出 CSV')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-500 dark:text-gray-400">{t('统计数据加载失败')}</p>
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
            {t('点击重试')}
          </button>
        </div>
      ) : (!stats || stats.count === 0) && (!incomeStats || incomeStats.count === 0) ? (
        <div className="card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <p className="text-gray-400 dark:text-gray-500">{t('该时间段暂无数据')}</p>
        </div>
      ) : (
        <>
          {/* ── 汇总卡片：总支出 / 总收入 / 总笔数 / 结余 ── */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总支出')}</p>
              <p className="text-xl font-bold text-red-500">¥{stats.totalAmount.toFixed(2)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总收入')}</p>
              <p className="text-xl font-bold text-green-500">¥{(incomeStats?.totalAmount ?? 0).toFixed(2)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总笔数')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.count + (incomeStats?.count ?? 0)}</p>
            </div>
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('结余')}</p>
              <p className={`text-xl font-bold ${(incomeStats?.totalAmount ?? 0) - stats.totalAmount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ¥{((incomeStats?.totalAmount ?? 0) - stats.totalAmount).toFixed(2)}
              </p>
            </div>
          </div>

          {/* ── 图表区：两个环形图 + 折线图 ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 环形图 1：支出分类占比 */}
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('支出分类占比')}</h3>
              <ResponsiveContainer width="100%" height={280}>
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
                    label={renderLabel}
                    labelLine={true}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, t('金额')]}
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

            {/* 环形图 2：第一大类的二级分类明细（下钻） */}
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {topCategory1 ? `「${topCategory1}」${t('二级分类')}` : t('二级分类明细')}
              </h3>
              {subPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={subPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      innerRadius={55}
                      strokeWidth={0}
                      label={renderLabel}
                      labelLine={true}
                    >
                      {subPieData.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [`¥${value.toFixed(2)}`, t('金额')]}
                      labelFormatter={(name: string) => name}
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        fontSize: '13px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[280px] text-gray-400 dark:text-gray-500 text-sm">
                  {t('暂无数据')}
                </div>
              )}
            </div>

            {/* 折线图：每日支出趋势（全宽） */}
            <div className="card dark:bg-gray-800 dark:border-gray-700 p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('每日支出趋势')}</h3>
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
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, t('支出')]}
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
                    name={t('支出金额')}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 分类明细表：所有二级分类的金额/笔数/占比 ── */}
          <div className="card dark:bg-gray-800 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('分类明细')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">{t('一级分类')}</th>
                    <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">{t('二级分类')}</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">{t('总笔数')}</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">{t('金额')}</th>
                    <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">{t('占比')}</th>
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
