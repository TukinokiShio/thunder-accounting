/**
 * 统计卡片明细弹窗。
 * 点击首页 6 张统计卡片（今日支出 / 本月支出 / 日均支出 / 累计记录 / 本月收入 / 本月结余）后弹出，
 * 展示图形化组成拆解（环形图 / 柱状图 / 进度条 / 公式条）+ 逐笔明细。
 *
 * 只读：仅通过 getBills / getStats 读取数据，不写库、不新增 IPC 通道。
 * 参考既有范式：ConfirmDialog.tsx（dialog 骨架 / 焦点管理 / Escape / Tab trap）、
 * Stats.tsx（环形图 + 自定义 Legend / Tooltip 替代 inline label）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { X } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import { useLanguage } from '@/i18n/LanguageContext'
import { modalPortalScope } from '@/utils/modalScope'
import type { Bill, StatsResult } from '@/types'

/** 卡片标识 */
export type StatCardKey =
  | 'todayExpense'    // 今日支出
  | 'monthExpense'    // 本月支出
  | 'dailyAvg'        // 日均支出
  | 'monthRecords'    // 累计记录
  | 'monthIncome'     // 本月收入
  | 'monthBalance'    // 本月结余

interface Props {
  open: boolean
  cardKey: StatCardKey | null
  onClose: () => void
}

/** 图表配色：全部使用 CSS 语义变量，自动适配深色模式 */
const COLORS = [
  'var(--accent)', 'var(--danger)', 'var(--success)', 'var(--warn)', 'var(--accent-h)',
  'var(--text3)', 'var(--chart-axis)', 'var(--text2)'
]

/**
 * 图表绘制动画时长（毫秒）。
 * recharts 默认 animationDuration = 1500ms，环形图/柱状图要"画"1.5 秒才成形，
 * 点击卡片后有明显的慢半拍感。压到 300ms：保留一点轻动感，但接近即时呈现。
 */
const CHART_ANIM_DURATION = 300

/** 计算占比字符串 */
function pct(value: number, total: number): string {
  if (total <= 0) return '0.0%'
  return ((value / total) * 100).toFixed(1) + '%'
}

/** 明细金额绝对值求和（与顶部汇总同源） */
function sumAbs(bills: Bill[]): number {
  return bills.reduce((s, b) => s + Math.abs(b.amount), 0)
}

/** 按一级分类聚合金额，降序 */
function groupByCategory(bills: Bill[]): Array<{ name: string; value: number }> {
  const map = new Map<string, number>()
  for (const b of bills) {
    map.set(b.category1, (map.get(b.category1) ?? 0) + Math.abs(b.amount))
  }
  return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

/** 当前周期派生值（今日 / 本月区间 / 已过天数），供数据加载与渲染复用，避免两处各算一遍 */
function currentPeriod(now = new Date()) {
  return {
    todayStr: format(now, 'yyyy-MM-dd'),
    monthStart: format(startOfMonth(now), 'yyyy-MM-dd'),
    monthEnd: format(endOfMonth(now), 'yyyy-MM-dd'),
    daysElapsed: Math.max(1, now.getDate())
  }
}

/** 自定义 Legend：颜色圆点 + 分类名 + 占比，替代 inline label 以避免标签重叠 */
type LegendEntry = { value?: string; color?: string; payload?: { value?: number } }
const renderLegend = ({ payload }: { payload?: LegendEntry[] }) => {
  if (!payload) return null
  const total = payload.reduce((s, p) => s + (p.payload?.value ?? 0), 0)
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs mt-2">
      {payload.map((entry) => (
        <li key={entry.value} className="flex items-center gap-1 text-[var(--text2)]">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span>{entry.value}</span>
          <span className="text-[var(--text3)]">{pct(entry.payload?.value ?? 0, total)}</span>
        </li>
      ))}
    </ul>
  )
}

/** 自定义 Tooltip：分类名 + 金额 + 占比 */
const renderTooltip = (total: number) => ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const value = item.value as number
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-sm text-[var(--text)]">
      <p className="font-medium">{item.name}</p>
      <p className="text-[var(--text2)]">¥{value.toFixed(2)}</p>
      <p className="text-[var(--text3)] text-xs">{pct(value, total)}</p>
    </div>
  )
}

interface DialogData {
  todayBills: Bill[]
  monthBills: Bill[]
  expenseStats: StatsResult
  incomeStats: StatsResult
}

interface CardView {
  subtitle: string
  bigNumber: string
  bigColor?: string
  empty: boolean
  chart: ReactNode
  detail: ReactNode
}

export function StatCardDetailDialog({ open, cardKey, onClose }: Props) {
  const { t } = useLanguage()
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [data, setData] = useState<DialogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // 打开时记录焦点并在关闭时还原；同时锁定背景滚动
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    dialogRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open])

  // 打开时按需拉取数据（账单明细 + 聚合统计），用 cancelled 防止竞态 / 卸载后 setState
  useEffect(() => {
    if (!open || !cardKey) return
    let cancelled = false
    setLoading(true)
    setError(false)
    setData(null)

    const { todayStr, monthStart, monthEnd } = currentPeriod()

    void (async () => {
      try {
        const [monthBills, todayBills, expenseStats, incomeStats] = await Promise.all([
          window.electronAPI.getBills({ startDate: monthStart, endDate: monthEnd }),
          window.electronAPI.getBills({ startDate: todayStr, endDate: todayStr }),
          window.electronAPI.getStats(monthStart, monthEnd, 'expense'),
          window.electronAPI.getStats(monthStart, monthEnd, 'income')
        ])
        if (cancelled) return
        setData({ monthBills, todayBills, expenseStats, incomeStats })
      } catch (e) {
        if (cancelled) return
        console.error('Failed to load stat card detail:', e)
        setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, cardKey])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (!open || !cardKey) return null

  const { todayStr, monthStart, monthEnd, daysElapsed } = currentPeriod()

  const titleMap: Record<StatCardKey, string> = {
    todayExpense: t('今日支出'),
    monthExpense: t('本月支出'),
    dailyAvg: t('日均支出'),
    monthRecords: t('累计记录'),
    monthIncome: t('本月收入'),
    monthBalance: t('本月结余')
  }

  /** 图表：环形图 */
  const renderPie = (pieData: Array<{ name: string; value: number }>, total: number) => (
    <div data-testid="stat-dialog-chart" className="w-full" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={70}
            innerRadius={42}
            strokeWidth={0}
            animationDuration={CHART_ANIM_DURATION}
          >
            {pieData.map((_, idx) => (
              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={renderTooltip(total)} />
          <Legend content={renderLegend} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )

  /** 明细：逐笔账单列表（滚动） */
  const renderBillList = (bills: Bill[]) => (
    <div className="max-h-[240px] overflow-y-auto" data-testid="stat-dialog-list">
      {bills.map((b) => (
        <div key={b.id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-b-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--text)] truncate">{b.category1} · {b.category2}</p>
            <p className="text-xs text-[var(--text3)]">{b.date}</p>
          </div>
          <span
            className="ml-3 shrink-0 text-sm font-semibold"
            style={{ color: b.type === 'income' ? 'var(--success)' : 'var(--danger)' }}
          >
            {b.type === 'income' ? '+' : '-'}¥{Math.abs(b.amount).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  )

  /** 日均支出：每日支出柱状图 */
  const renderBar = (byDate: StatsResult['byDate']) => {
    const barData = byDate.map((d) => ({ date: d.date.slice(5), amount: d.total }))
    return (
      <div data-testid="stat-dialog-chart" className="w-full mt-3" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData}>
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
            <Bar
              dataKey="amount"
              name={t('支出')}
              fill="var(--accent)"
              radius={[3, 3, 0, 0]}
              animationDuration={CHART_ANIM_DURATION}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  /** 日均支出：每日合计明细 */
  const renderDailyTotals = (byDate: StatsResult['byDate']) => (
    <div className="max-h-[240px] overflow-y-auto" data-testid="stat-dialog-list">
      {byDate.map((d) => (
        <div key={d.date} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-b-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--text)]">{d.date}</p>
            <p className="text-xs text-[var(--text3)]">{d.count} {t('笔')}</p>
          </div>
          <span className="ml-3 shrink-0 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
            -¥{d.total.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  )

  /** 结余：对比行 */
  const renderBalanceRow = (label: string, value: number, color: string, sign = '') => (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-b-0">
      <span className="text-sm text-[var(--text)]">{label}</span>
      <span className="text-sm font-semibold" style={{ color }}>
        {sign}¥{Math.abs(value).toFixed(2)}
      </span>
    </div>
  )

  /** 依据 cardKey 构造弹窗内容；data 就绪时才有值 */
  const buildView = (): CardView | null => {
    if (!data) return null

    const monthAll = data.monthBills
    const monthExpense = monthAll.filter((b) => b.type === 'expense')
    const monthIncome = monthAll.filter((b) => b.type === 'income')
    const todayExpense = data.todayBills.filter((b) => b.type === 'expense')

    switch (cardKey) {
      case 'todayExpense': {
        const total = sumAbs(todayExpense)
        return {
          subtitle: `${todayStr} · ${todayExpense.length} ${t('笔')}`,
          bigNumber: `¥${total.toFixed(2)}`,
          empty: todayExpense.length === 0,
          chart: (
            <>
              <p className="text-xs text-[var(--text2)] mb-1">{t('分类占比')}</p>
              {renderPie(groupByCategory(todayExpense), total)}
            </>
          ),
          detail: renderBillList(todayExpense)
        }
      }
      case 'monthExpense': {
        const total = sumAbs(monthExpense)
        return {
          subtitle: `${monthStart} ~ ${monthEnd} · ${monthExpense.length} ${t('笔')}`,
          bigNumber: `¥${total.toFixed(2)}`,
          empty: monthExpense.length === 0,
          chart: (
            <>
              <p className="text-xs text-[var(--text2)] mb-1">{t('分类占比')}</p>
              {renderPie(groupByCategory(monthExpense), total)}
            </>
          ),
          detail: renderBillList(monthExpense)
        }
      }
      case 'dailyAvg': {
        const total = sumAbs(monthExpense)
        const avg = total / daysElapsed
        return {
          subtitle: `${monthStart} ~ ${monthEnd} · ${data.expenseStats.count} ${t('笔')}`,
          bigNumber: `¥${avg.toFixed(2)}`,
          empty: monthExpense.length === 0,
          chart: (
            <>
              <p className="text-xs text-[var(--text2)] mb-1">{t('计算过程')}</p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text)]">
                {t('本月支出')} ¥{total.toFixed(2)} ÷ {t('已过天数')} {daysElapsed} = {t('日均')} ¥{avg.toFixed(2)}
              </div>
              {renderBar(data.expenseStats.byDate)}
            </>
          ),
          detail: (
            <>
              <p className="text-xs text-[var(--text2)] mb-1">{t('每日合计')}</p>
              {renderDailyTotals(data.expenseStats.byDate)}
            </>
          )
        }
      }
      case 'monthRecords': {
        const expenseTotal = sumAbs(monthExpense)
        const incomeTotal = sumAbs(monthIncome)
        const pieData = [
          { name: t('支出'), value: expenseTotal },
          { name: t('收入'), value: incomeTotal }
        ].filter((d) => d.value > 0)
        return {
          subtitle: `${monthStart} ~ ${monthEnd} · ${monthAll.length} ${t('笔')}`,
          // 大字与首页卡片主指标一致（记录笔数）；金额通过下方拆解块与逐笔明细追溯
          bigNumber: `${monthAll.length} ${t('笔')}`,
          empty: monthAll.length === 0,
          chart: (
            <>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text)]">
                {t('支出合计')} ¥{expenseTotal.toFixed(2)} · {t('收入合计')} ¥{incomeTotal.toFixed(2)} · {t('合计')} ¥{(expenseTotal + incomeTotal).toFixed(2)}
              </div>
              <p className="text-xs text-[var(--text2)] mt-3 mb-1">{t('本月收支构成')}</p>
              {renderPie(pieData, expenseTotal + incomeTotal)}
            </>
          ),
          detail: renderBillList(monthAll)
        }
      }
      case 'monthIncome': {
        const total = sumAbs(monthIncome)
        return {
          subtitle: `${monthStart} ~ ${monthEnd} · ${monthIncome.length} ${t('笔')}`,
          bigNumber: `¥${total.toFixed(2)}`,
          empty: monthIncome.length === 0,
          chart: (
            <>
              <p className="text-xs text-[var(--text2)] mb-1">{t('分类占比')}</p>
              {renderPie(groupByCategory(monthIncome), total)}
            </>
          ),
          detail: renderBillList(monthIncome)
        }
      }
      case 'monthBalance': {
        const incomeTotal = sumAbs(monthIncome)
        const expenseTotal = sumAbs(monthExpense)
        const balance = incomeTotal - expenseTotal
        const ratio = incomeTotal > 0
          ? (expenseTotal / incomeTotal) * 100
          : (expenseTotal > 0 ? 100 : 0)
        const over = expenseTotal > incomeTotal
        return {
          subtitle: `${monthStart} ~ ${monthEnd} · ${monthAll.length} ${t('笔')}`,
          bigNumber: `¥${balance.toFixed(2)}`,
          bigColor: balance >= 0 ? 'var(--success)' : 'var(--danger)',
          empty: monthAll.length === 0,
          chart: (
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--text2)] mb-1">
                <span>
                  {t('支出合计')} ¥{expenseTotal.toFixed(2)} / {t('收入合计')} ¥{incomeTotal.toFixed(2)}
                </span>
                <span>{ratio.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(ratio, 100)}%`,
                    backgroundColor: over ? 'var(--danger)' : 'var(--accent)'
                  }}
                />
              </div>
              {over && (
                <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{t('支大于收')}</p>
              )}
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text)]">
                {t('收入合计')} ¥{incomeTotal.toFixed(2)} − {t('支出合计')} ¥{expenseTotal.toFixed(2)} ={' '}
                {t('结余')} ¥{balance.toFixed(2)}
              </div>
            </div>
          ),
          detail: (
            <div className="mt-3">
              {renderBalanceRow(t('收入合计'), incomeTotal, 'var(--success)', '+')}
              {renderBalanceRow(t('支出合计'), expenseTotal, 'var(--danger)', '-')}
              {/* 结余行与顶部大字逐字符一致（含负号），不复用 renderBalanceRow 的 abs 逻辑 */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-[var(--text)]">{t('结余')}</span>
                <span
                  className="text-sm font-semibold"
                  style={{ color: balance >= 0 ? 'var(--success)' : 'var(--danger)' }}
                >
                  ¥{balance.toFixed(2)}
                </span>
              </div>
            </div>
          )
        }
      }
      default:
        return null
    }
  }

  const view = !loading && !error ? buildView() : null

  // 通过 Portal 直接挂到 document.body，并用内联样式写死视口几何。
  // 原因：若 position:fixed 的包含块被应用树中的某个祖先（transform/filter/contain 等）影响，
  // 遮罩就会以该祖先为基准而无法铺满整个窗口（表现为顶部露白、顶栏未被压暗）。
  // 挂到 body 后祖先链只剩 body/html，几何用内联样式而非工具类，彻底不受上层结构影响。
  // z-index 取 9000：高于应用内容（z-[60]），低于 react-select 菜单 Portal（10000），
  // 保证「记一笔」里的分类下拉仍能正常盖在弹窗之上。
  const portalScope = modalPortalScope()

  return createPortal(
    <div
      className={`${portalScope.className} flex items-center justify-center`}
      data-theme={portalScope['data-theme']}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9000 }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
        data-testid="stat-dialog-backdrop"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stat-card-detail-title"
        tabIndex={-1}
        className="relative rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[85vh] overflow-y-auto animate-slide-up aurora-dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <h3 id="stat-card-detail-title" className="text-lg font-bold text-[var(--text)]">
              {titleMap[cardKey]}
            </h3>
            {view && <p className="text-xs text-[var(--text3)] mt-0.5">{view.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            className="p-1 rounded-lg text-[var(--text3)] hover:text-[var(--text)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--text2)]">{t('加载中...')}</p>
            <div className="mt-3 space-y-2">
              <div className="h-3 rounded bg-[var(--border)] animate-pulse" />
              <div className="h-3 rounded bg-[var(--border)] animate-pulse w-2/3 mx-auto" />
            </div>
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--danger)' }}>
            {t('加载失败，请重试')}
          </div>
        ) : view && view.empty ? (
          <div className="py-8 text-center text-sm text-[var(--text3)]">{t('暂无记录')}</div>
        ) : view ? (
          <>
            <p
              data-testid="stat-dialog-total"
              className="text-2xl font-bold mb-3 text-[var(--text)]"
              style={view.bigColor ? { color: view.bigColor } : undefined}
            >
              {view.bigNumber}
            </p>
            {view.chart}
            <div className="mt-4">{view.detail}</div>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
