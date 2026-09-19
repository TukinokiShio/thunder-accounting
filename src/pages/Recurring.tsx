/**
 * 周期支出页（v2.0）：订阅与机械定投的规则管理 + 到期入账。
 *
 * 结构（PRD docs/prd-v2.0.0-recurring.md §七）：
 * ① 顶部汇总卡：本月已入账 / 未来 30 天待发生 / 进行中项目
 * ② 到期区（置顶）：一键入账（预填弹窗）/ 本期跳过
 * ③ 项目列表：规则信息 + 累计已入账；展开该规则的历史账单
 * ④ 管理：新增 / 编辑 / 暂停 / 删除（删除只删规则，历史账单不受影响）
 *
 * 数据源纪律（rules §五 9）：本页自查数据 —— 历史账单用 getBills() 直取全量，
 * 不复用被「账单」页筛选污染的 store.bills。
 */
import { useEffect, useMemo, useState } from 'react'
import { Repeat, Plus, Pencil, Trash2, Pause, Play, ChevronDown, ChevronUp, Wallet } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { formatLocalDate } from '@/utils/date'
import { computeDueWindow, advanceDate, upcomingOccurrences, anchorDayOf, adjustToTradingDay } from '@/utils/recurringCycle'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { RecurringFormDialog } from '@/components/Recurring/RecurringFormDialog'
import type { Bill, Recurring } from '@/types'

export function RecurringPage() {
  const recurrings = useStore((s) => s.recurrings)
  const refreshRecurrings = useStore((s) => s.refreshRecurrings)
  const updateRecurringAction = useStore((s) => s.updateRecurringAction)
  const deleteRecurringAction = useStore((s) => s.deleteRecurringAction)
  const openAddDialogForRecurring = useStore((s) => s.openAddDialogForRecurring)
  const addToast = useStore((s) => s.addToast)
  const { t } = useLanguage()

  const [historyBills, setHistoryBills] = useState<Bill[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Recurring | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Recurring | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const today = formatLocalDate()

  useEffect(() => {
    void refreshRecurrings()
    // 本页自查全量账单（不经过被筛选的 store.bills，见文件头纪律）
    window.electronAPI.getBills()
      .then(setHistoryBills)
      .catch((e) => console.error('加载账单历史失败:', e))
  }, [refreshRecurrings])

  /** 到期规则（含漏期窗口） */
  const dueRules = useMemo(() => {
    return recurrings
      .filter((r) => !r.paused && r.next_date <= today)
      .map((r) => ({ rule: r, window: computeDueWindow(r, today, anchorDayOf(r.next_date)) }))
  }, [recurrings, today])

  /** 本月已入账（按账单日期归月） */
  const monthPrefix = today.slice(0, 7)
  const monthlyRecorded = useMemo(() => {
    const rows = historyBills.filter((b) => b.recurring_id && b.date.startsWith(monthPrefix))
    return { count: rows.length, total: rows.reduce((s, b) => s + b.amount, 0) }
  }, [historyBills, monthPrefix])

  /** 未来 30 天待发生（每条规则的首个未来期次；已在到期区的规则从下一期算起） */
  const upcomingTotal = useMemo(() => {
    let total = 0
    for (const r of recurrings) {
      if (r.paused) continue
      const occ = upcomingOccurrences(r, today, 30, anchorDayOf(r.next_date))
      // 已到期未处理的规则其到期期次由「一键入账」消化，未来 30 天从推进后的下一期算
      const future = r.next_date <= today
        ? [advanceDate(r.next_date, r.cycle_unit, r.cycle_interval, anchorDayOf(r.next_date))]
        : occ.slice(0, 1)
      if (future.length && future[0] <= addDays(today, 30)) total += r.amount
    }
    return total
  }, [recurrings, today])

  const activeCount = recurrings.filter((r) => !r.paused).length

  /** 每条规则的累计已入账 */
  const recurringStats = useMemo(() => {
    const map = new Map<number, { count: number; total: number }>()
    for (const b of historyBills) {
      if (!b.recurring_id) continue
      const cur = map.get(b.recurring_id) ?? { count: 0, total: 0 }
      cur.count += 1
      cur.total += b.amount
      map.set(b.recurring_id, cur)
    }
    return map
  }, [historyBills])

  const handleSkip = async (rule: Recurring) => {
    try {
      const anchor = anchorDayOf(rule.next_date)
      const next = advanceDate(rule.next_date, rule.cycle_unit, rule.cycle_interval, anchor)
      await updateRecurringAction(rule.id, { next_date: next })
      addToast('info', t('已跳过本期：{name}').replace('{name}', rule.name))
    } catch (e) {
      console.error('跳过本期失败:', e)
      addToast('error', t('操作失败，请重试'))
    }
  }

  const handleTogglePause = async (rule: Recurring) => {
    try {
      await updateRecurringAction(rule.id, { paused: rule.paused ? 0 : 1 })
    } catch (e) {
      console.error('切换暂停状态失败:', e)
      addToast('error', t('操作失败，请重试'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteRecurringAction(deleteTarget.id)
      addToast('success', t('已删除周期支出：{name}').replace('{name}', deleteTarget.name))
    } catch (e) {
      console.error('删除周期支出失败:', e)
      addToast('error', t('操作失败，请重试'))
    } finally {
      setDeleteTarget(null)
    }
  }

  const openOneClick = (rule: Recurring, dueDates: string[], nextDateAfter: string) => {
    openAddDialogForRecurring({
      recurringId: rule.id,
      name: rule.name,
      amount: rule.amount,
      category1: rule.category1,
      category2: rule.category2 || '',
      paymentPlatform: rule.payment_platform || '',
      fundAccount: rule.fund_account || '',
      dueDates,
      nextDateAfter
    })
  }

  const renderRuleRow = (rule: Recurring) => {
    const stat = recurringStats.get(rule.id) ?? { count: 0, total: 0 }
    const unitText = rule.cycle_unit === 'day' ? t('天')
      : rule.cycle_unit === 'week' ? t('周')
      : rule.cycle_unit === 'month' ? t('月')
      : t('年')
    const cycleText = t('每 {n} {unit}').replace('{n}', String(rule.cycle_interval)).replace('{unit}', unitText)
    // 「下次」展示实际发生日（仅交易日执行的规则，周末顺延后的日期）
    const nextActual = rule.trade_day_only ? adjustToTradingDay(rule.next_date) : rule.next_date
    const isExpanded = expandedId === rule.id
    const history = historyBills.filter((b) => b.recurring_id === rule.id)

    return (
      <div key={rule.id} className="rounded-xl border aurora-border bg-white dark:bg-gray-800 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent-dim)] text-[var(--accent)]">
            <Repeat size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {rule.name}
              {rule.symbol ? <span className="ml-1.5 text-xs font-normal text-gray-400 font-mono">{rule.symbol}</span> : null}
              {rule.paused === 1 && <span className="ml-2 text-xs text-gray-400">{t('已暂停')}</span>}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {cycleText} · {t('下次')} {nextActual}
              {rule.trade_day_only === 1 ? ` ${t('(非交易日顺延)')}` : ''}
              {rule.payment_platform ? ` · ${t('支付平台')}${t('：')}${rule.payment_platform}` : ''}
              {rule.fund_account ? ` · ${t('资金账户')}${t('：')}${rule.fund_account}` : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-mono font-semibold text-red-500">¥{rule.amount.toFixed(2)}</p>
            <p className="text-xs text-gray-400">
              {t('已入账 {n} 笔').replace('{n}', String(stat.count))}
              {stat.count > 0 ? ` · ¥${stat.total.toFixed(2)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(rule)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label={t('编辑')}
              title={t('编辑')}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() => void handleTogglePause(rule)}
              className="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
              aria-label={rule.paused ? t('恢复') : t('暂停')}
              title={rule.paused ? t('恢复') : t('暂停')}
            >
              {rule.paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(rule)}
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              aria-label={t('删除')}
              title={t('删除')}
            >
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : rule.id)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? t('收起历史') : t('查看历史')}
              title={isExpanded ? t('收起历史') : t('查看历史')}
            >
              {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t aurora-border px-4 py-3 bg-gray-50 dark:bg-gray-750">
            {history.length === 0 ? (
              <p className="text-xs text-gray-400">{t('还没有入账记录')}</p>
            ) : (
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {history.map((b) => (
                  <li key={b.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-mono">{b.date}</span>
                    <span className="text-gray-500 dark:text-gray-400 truncate max-w-[45%]">{b.category1}{b.category2 ? `·${b.category2}` : ''}</span>
                    <span className="font-mono text-red-500">-¥{b.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-400 mt-2">{t('删除规则不会影响以上已入账的历史账单')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <section aria-label={t('周期支出')} className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('周期支出')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('订阅与定投，到期一键入账')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditing(null); setFormOpen(true) }}
          className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
        >
          <Plus size={16} />
          {t('新增')}
        </button>
      </div>

      {/* 汇总卡 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border aurora-border bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs text-gray-400">{t('本月已入账')}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">¥{monthlyRecorded.total.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{t('{n} 笔').replace('{n}', String(monthlyRecorded.count))}</p>
        </div>
        <div className="rounded-xl border aurora-border bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs text-gray-400">{t('未来 30 天待发生')}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">¥{upcomingTotal.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border aurora-border bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs text-gray-400">{t('进行中项目')}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">{activeCount}</p>
        </div>
      </div>

      {/* 到期区（置顶） */}
      {dueRules.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-3">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <Wallet size={15} aria-hidden="true" />
            {t('到期待处理')}
          </h3>
          {dueRules.map(({ rule, window: win }) => (
            <div key={rule.id} className="flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {rule.name}
                  {rule.symbol ? <span className="ml-1.5 text-xs font-normal text-gray-400 font-mono">{rule.symbol}</span> : null}
                  {win.dueDates.length > 1 && (
                    <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                      {t('已漏 {n} 期').replace('{n}', String(win.dueDates.length))}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {win.dueDates.join(t('、'))} · ¥{rule.amount.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openOneClick(rule, win.dueDates, win.nextDateAfter)}
                  className="btn-primary text-xs"
                >
                  {t('一键入账')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSkip(rule)}
                  className="btn-secondary text-xs"
                >
                  {t('本期跳过')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 项目列表 */}
      {recurrings.length === 0 ? (
        <div className="rounded-xl border aurora-border bg-white dark:bg-gray-800 px-6 py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('还没有周期支出项目')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('在「记一笔」里选择「周期支出」，或点击右上角「新增」')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recurrings.map(renderRuleRow)}
        </div>
      )}

      {/* 新增/编辑弹窗（Portal + 作用域替身） */}
      <RecurringFormDialog isOpen={formOpen} editing={editing} onClose={() => setFormOpen(false)} />

      {/* 删除确认（危险操作；只删规则，不删历史账单） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        danger
        title={t('删除周期支出')}
        message={t('确定删除「{name}」吗？已生成的历史账单会保留。')
          .replace('{name}', deleteTarget?.name ?? '')}
        confirmLabel={t('删除')}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}

/** 今天 + n 天（本地日历语义，与 parseLocalDate 一致） */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
