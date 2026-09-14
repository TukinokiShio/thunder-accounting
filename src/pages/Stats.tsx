/**
 * 统计概览页面。
 * 信息层级收敛为 5 层：结论（4 张汇总卡）→ 分解（一级环形图 + 明细小表）→ 下钻（二级，按需展开）
 * → 趋势（折线图）→ 明细（全量表，默认折叠）。
 * 上述收敛**只对安卓窄屏生效**（`isAndroid()` 门控）；桌面走 `!android` 分支，与改动前逐字符一致
 * —— 包括桌面保留两张环形图的 Legend（即使它在一级明细小表里是冗余的）。
 * 支持本月 / 上月 / 近3个月三个时间粒度切换，以及 CSV 导出。
 *
 * 参考：https://github.com/qsor/budget-manager（图表+表格组合模式）
 *       https://github.com/iambhavesh55/personal-finance-dashboard（Legend 替代 inline labels）
 */
import { useEffect, useState, useCallback, type KeyboardEvent } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts'
import { Download, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { isAndroid } from '@/platform'
import type { StatsResult } from '@/types'

/**
 * 图表入场动画时长（ms）。
 * recharts 2.15.4 默认 1500ms，安卓 WebView 上体感明显拖沓；项目约定新图表一律 300ms
 * （见 `src/components/StatCardDetailDialog.tsx` 的同名常量）。本页曾是唯一未统一处。
 */
const CHART_ANIM_DURATION = 300

const COLORS = [
  'var(--accent)', 'var(--danger)', 'var(--success)', 'var(--warn)', 'var(--accent-h)',
  'var(--text3)', 'var(--chart-axis)', 'var(--text2)', 'var(--border-h)', 'var(--text)'
]

/** 计算总金额的百分比 */
function pct(value: number, total: number): string {
  if (total <= 0) return '0.0%'
  return ((value / total) * 100).toFixed(1) + '%'
}

/**
 * 自定义 Legend 渲染函数：显示颜色圆点 + 分类名 + 百分比。（仅在**桌面**渲染，见下方两张环形图）
 * Legend 代替 inline label，彻底避免标签重叠问题。
 *
 * 为什么要按平台分叉、而不是干脆删掉：
 * 同一张卡内紧邻的一级/二级明细小表渲染「分类名 + 笔数 + 金额 + 占比」，小表是 Legend 的**超集**
 * （多出笔数与金额），所以**在安卓窄屏**上删掉 Legend 是纯去重，不丢信息。
 * 但本轮授权范围是「四个**安卓**板块」，「桌面零变化」是对用户反复承诺的不变量 ——
 * **桌面即使有冗余也必须保留**：删掉桌面冗余是**另一个独立决策**，应当显式提出、由用户选择，
 * 而不是夹在安卓改动里静默发生。
 */
type LegendEntry = { value?: string; color?: string; payload?: { value?: number } }
const renderLegend = ({ payload }: { payload?: LegendEntry[] }) => {
  if (!payload) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs mt-2">
      {payload.map((entry) => (
        <li key={entry.value} className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span>{entry.value}</span>
          <span className="text-gray-400 dark:text-gray-500">
            {pct(entry.payload?.value ?? 0, payload.reduce((s: number, p: LegendEntry) => s + (p.payload?.value ?? 0), 0))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 自定义 tooltip 内容：分类名 + 金额 + 笔数 + 占比 */
const renderTooltip = (
  total: number,
  t: (key: string) => string,
  byCategory2?: StatsResult['byCategory2']
) => ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const name = item.name
  const value = item.value as number
  // 在 byCategory2 中查找对应的 count（仅二级分类有，一级分类无 count）
  const count = byCategory2
    ? byCategory2.filter(c => c.category2 === name).reduce((s, c) => s + c.count, 0)
    : null
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-sm text-[var(--text)]">
      <p className="font-medium">{name}</p>
      <p className="text-[var(--text2)]">¥{value.toFixed(2)}</p>
      <p className="text-[var(--text3)] text-xs">
        {pct(value, total)} · {count !== null ? `${count} ${t('笔')}` : ''}
      </p>
    </div>
  )
}

export function Stats() {
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | 'last3Months'>('thisMonth')
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  /** 安卓端下钻层选中的一级分类（null = 收起，二级环形图与小表都不渲染） */
  const [drillCategory, setDrillCategory] = useState<string | null>(null)
  /** 安卓端「明细层」（全量表）是否展开，默认折叠 */
  const [detailsOpen, setDetailsOpen] = useState(false)
  const addToast = useStore((s) => s.addToast)
  const { t } = useLanguage()

  /**
   * 平台判定：安卓竖屏可用内容高仅 711px，而本页图表原先硬编码 240/240/260 = 740px
   * （首屏的 104%），且二级环形图默认渲染、全量表 5 列在 308px 容器里横向溢出 76px。
   * 这些结构性收敛只对安卓端生效；桌面（Electron）走下面的 `!android` 分支，DOM 与渲染
   * 与改动前逐位一致。桌面不做下钻/折叠，也没有额外包一层标题容器。
   */
  const android = isAndroid()
  const PIE_HEIGHT = android ? 200 : 240
  const LINE_HEIGHT = android ? 200 : 260

  const now = new Date()

  const dateRange = (() => {
    switch (period) {
      case 'thisMonth':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
          label: format(now, t('yyyy年M月'))
        }
      case 'lastMonth': {
        const lm = subMonths(now, 1)
        return {
          start: format(startOfMonth(lm), 'yyyy-MM-dd'),
          end: format(endOfMonth(lm), 'yyyy-MM-dd'),
          label: format(lm, t('yyyy年M月'))
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

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [exp, inc] = await Promise.all([
      window.electronAPI.getStats(dateRange.start, dateRange.end, 'expense'),
      window.electronAPI.getStats(dateRange.start, dateRange.end, 'income')
      ])
      setStats(exp)
      setIncomeStats(inc)
    } catch (e) {
      console.error(e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [dateRange.start, dateRange.end])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

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

  const pieData = stats?.byCategory1.map((c) => ({
    name: c.category1,
    value: c.total
  })) ?? []

  const lineData = stats?.byDate.map((d) => ({
    date: d.date.slice(5),
    amount: d.total
  })) ?? []

  const topCategory1 = stats?.byCategory1[0]?.category1 ?? null

  /**
   * 下钻层的一级分类：安卓端默认 null（收起，省约 434px），点击卡1 小表某一行后才有值；
   * 桌面端沿用旧行为「默认展示金额最大的一级分类」，故此处取 topCategory1，值与原实现相同。
   */
  const drillCategory1 = android ? drillCategory : topCategory1

  const subPieData = drillCategory1
    ? stats?.byCategory2.filter((c) => c.category1 === drillCategory1)
        .map((c) => ({ name: c.category2, value: c.total }))
    : []
  const safeSubPieData = subPieData ?? []

  const totalAmount = stats?.totalAmount ?? 0
  const incomeTotal = incomeStats?.totalAmount ?? 0

  return (
    <div className="page-view w-full min-w-0 space-y-6">
      {/* ── 时间粒度选择器 + CSV 导出按钮 ── */}
      <div className="stats-toolbar flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="stats-periods flex flex-wrap items-center gap-1 rounded-lg p-1 min-w-0">
          {([
            ['thisMonth', t('本月')],
            ['lastMonth', t('上月')],
            ['last3Months', t('近3个月')]
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`stats-period shrink-0 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${period === key
                  ? 'is-active'
                  : ''
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        <button onClick={handleExport} className="btn-secondary stats-export shrink-0 text-sm flex items-center gap-1.5">
          <Download size={14} />
          {t('导出 CSV')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="card stats-card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-500 dark:text-gray-400">{t('统计数据加载失败')}</p>
          <button
            onClick={() => void loadStats()}
            className="mt-3 text-sm text-[var(--accent)] hover:text-[var(--accent-h)] font-medium"
          >
            {t('点击重试')}
          </button>
        </div>
      ) : !stats || stats.count === 0 && (!incomeStats || incomeStats.count === 0) ? (
        <div className="card stats-card dark:bg-gray-800 dark:border-gray-700 py-16 text-center">
          <p className="text-gray-400 dark:text-gray-500">{t('该时间段暂无数据')}</p>
        </div>
      ) : (
        <>
          {/* ── 汇总卡片 ── */}
          <div className="stats-summary-grid grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card stats-card stats-summary-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总支出')}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--danger)' }}>¥{totalAmount.toFixed(2)}</p>
            </div>
            <div className="card stats-card stats-summary-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总收入')}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--success)' }}>¥{incomeTotal.toFixed(2)}</p>
            </div>
            <div className="card stats-card stats-summary-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('总笔数')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.count + (incomeStats?.count ?? 0)}</p>
            </div>
            <div className="card stats-card stats-summary-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('结余')}</p>
              <p
                className="text-xl font-bold"
                style={{ color: incomeTotal - totalAmount >= 0 ? 'var(--success)' : 'var(--danger)' }}
              >
                ¥{(incomeTotal - totalAmount).toFixed(2)}
              </p>
            </div>
          </div>

          {/* ── 图表区 ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 环形图 1：支出分类占比（分类名 + 占比由下方小表承担，已移除 Legend 以去重） */}
            <div className="card stats-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('支出分类占比')}</h3>
              <ResponsiveContainer width="100%" height={PIE_HEIGHT}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={50}
                    strokeWidth={0}
                    animationDuration={CHART_ANIM_DURATION}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={renderTooltip(totalAmount, t, stats?.byCategory2)} />
                  {/* 桌面保留 Legend（与改动前一致）；安卓窄屏删掉它 —— 分类名与占比已由下方
                      一级明细小表承担，小表还多出笔数与金额，所以窄屏删 Legend 是纯去重。 */}
                  {!android && <Legend content={renderLegend} />}
                </PieChart>
              </ResponsiveContainer>
              {/* 一级分类明细小表：Legend 的超集（多出笔数/金额），分类名与占比在此渲染。
                  安卓端每一行同时是下钻入口（点击展开卡2 的二级分类环形图 + 小表）。 */}
              {stats.byCategory1.length > 0 && (
                <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                  {/* 下钻入口的可发现性：安卓端显式给一行提示（桌面端不渲染该节点，DOM 不变） */}
                  {android && (
                    <p className="mb-1 text-xs text-gray-400 dark:text-gray-500">{t('点击分类查看二级明细')}</p>
                  )}
                  {stats.byCategory1.map((row, idx) => {
                    const selected = android && drillCategory === row.category1
                    return (
                      <div
                        key={row.category1}
                        /* 桌面端保持原 class 字符串，安卓端才追加可点击态 */
                        className={android
                          ? `-mx-1 flex items-center justify-between px-1 py-1.5 text-xs rounded ${selected ? 'bg-[var(--accent-dim)]' : ''}`
                          : 'flex items-center justify-between py-1.5 text-xs'}
                        {...(android
                          ? {
                              role: 'button' as const,
                              tabIndex: 0,
                              'aria-pressed': selected,
                              'aria-label': `${row.category1} ${t('二级分类')}`,
                              onClick: () => setDrillCategory(selected ? null : row.category1),
                              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setDrillCategory(selected ? null : row.category1)
                                }
                              }
                            }
                          : {})}
                      >
                        {/* max-sm: 限定 —— 这两条是给窄屏（308px 卡内宽）防溢出用的，
                            ≥640px 不出现，class 集与改动前一致（详见 Home.tsx 的纪律说明） */}
                        <div className="flex items-center gap-2 max-sm:min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-gray-700 dark:text-gray-300 max-sm:truncate">{row.category1}</span>
                        </div>
                        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                          <span>{row.count} {t('笔')}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">¥{row.total.toFixed(2)}</span>
                          <span className="text-gray-400">{pct(row.total, totalAmount)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 环形图 2：二级分类下钻。
                安卓端默认不渲染（整卡省约 434px），由卡1 小表点击一级分类触发，卡内提供「收起」；
                桌面端维持旧行为（默认展示金额最大的一级分类），DOM 与渲染不变。 */}
            {(!android || drillCategory1 !== null) && (
              <div
                className="card stats-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-5"
                {...(android ? { 'data-testid': 'stats-subcategory-card' } : {})}
              >
                {android ? (
                  <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {`${t('「')}${drillCategory1}${t('」')}${t('二级分类')}`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDrillCategory(null)}
                      data-testid="stats-drill-close"
                      className="shrink-0 text-xs font-medium text-[var(--accent)] min-h-[32px] px-1"
                    >
                      {t('收起')}
                    </button>
                  </div>
                ) : (
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    {topCategory1 ? `${t('「')}${topCategory1}${t('」')}${t('二级分类')}` : t('二级分类明细')}
                  </h3>
                )}
                {safeSubPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={PIE_HEIGHT}>
                    <PieChart>
                      <Pie
                        data={safeSubPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={85}
                        innerRadius={50}
                        strokeWidth={0}
                        animationDuration={CHART_ANIM_DURATION}
                      >
                        {safeSubPieData.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={renderTooltip(totalAmount, t)} />
                      {!android && <Legend content={renderLegend} />}
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div
                    className="flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm"
                    style={{ height: PIE_HEIGHT }}
                  >
                    {t('暂无数据')}
                  </div>
                )}
                {/* 二级分类明细小表 */}
                {safeSubPieData.length > 0 && drillCategory1 && (
                  <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                    {stats.byCategory2
                      .filter(c => c.category1 === drillCategory1)
                      .map((row, idx) => (
                        <div key={row.category2} className="flex items-center justify-between py-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                            <span className="text-gray-700 dark:text-gray-300">{row.category2}</span>
                          </div>
                          <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                            <span>{row.count} {t('笔')}</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">¥{row.total.toFixed(2)}</span>
                            <span className="text-gray-400">{pct(row.total, totalAmount)}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* 折线图 */}
            <div className="card stats-card min-w-0 dark:bg-gray-800 dark:border-gray-700 p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('每日支出趋势')}</h3>
              <ResponsiveContainer width="100%" height={LINE_HEIGHT}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                    axisLine={{ stroke: 'var(--chart-axis)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `¥${v}`}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, t('支出')]}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--chart-tooltip-border)',
                      fontSize: '13px',
                      backgroundColor: 'var(--chart-tooltip-bg)',
                      color: 'var(--chart-tooltip-text)'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    name={t('支出金额')}
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: 'var(--accent)', strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: 'var(--accent-h)', strokeWidth: 2, stroke: 'var(--bg-card)' }}
                    animationDuration={CHART_ANIM_DURATION}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 全量分类明细表 ──
              安卓端默认折叠（一行标题 + 展开按钮）；展开后只显示「分类 + 金额」两列主信息，
              笔数与占比降为次要行内信息 —— 原 5 列表格在 308px 容器里内容约 384px，
              必须横滑才能看到金额与占比，这里彻底消除横向溢出。
              桌面端仍渲染原来的 5 列表格（DOM 与渲染不变，也不显示折叠按钮）。 */}
          {android ? (
            <div className="card stats-card dark:bg-gray-800 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('分类明细')}</h3>
                <button
                  type="button"
                  onClick={() => setDetailsOpen((open) => !open)}
                  aria-expanded={detailsOpen}
                  aria-controls="stats-details-panel"
                  data-testid="stats-details-toggle"
                  className="shrink-0 text-xs font-medium text-[var(--accent)] min-h-[32px] px-1"
                >
                  {detailsOpen ? t('收起') : t('展开')}
                </button>
              </div>
              {detailsOpen && (
                <div id="stats-details-panel" data-testid="stats-details-panel">
                  {stats.byCategory2.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 dark:border-gray-700"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-200 truncate">
                          {row.category1} · {row.category2}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {row.count} {t('笔')} · {pct(row.total, totalAmount)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-gray-900 dark:text-gray-200">
                        ¥{row.total.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card stats-card dark:bg-gray-800 dark:border-gray-700 p-5">
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
                          {pct(row.total, totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
