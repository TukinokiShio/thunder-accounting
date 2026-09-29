import { useCallback, useEffect, useState } from 'react'
import { Check, Clipboard, FolderOpen, Loader2, RefreshCw, ShieldCheck, X, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLanguage } from '@/i18n/LanguageContext'
import { useStore } from '@/store'
import type { AgentProposalPreview, AgentSyncContextInfo, InvestmentPositionView } from '@/types/agentSync'
import type { InvestmentHolding } from '@/utils/investmentHoldings'
import type { InvestmentSnapshot } from '@/utils/investmentReturns'
import { calculateInvestmentReturns } from '@/utils/investmentReturns'
import { buildInvestmentAllocation, buildInvestmentTrend, hasCurrentSnapshotForEveryPosition, parseMarketValue, positionTotalCost } from '@/utils/investmentDashboard'

const INVESTMENT_COLORS = ['#d59b25', '#3c8d72', '#5478a8', '#af725c', '#8b73a9', '#6998a8']
type InvestmentDisplayField = keyof InvestmentHolding

const HOLDING_FIELDS: InvestmentDisplayField[] = [
  'asset_key', 'name', 'asset_type', 'quantity', 'quantity_kind', 'cost_basis', 'cost_basis_kind',
  'market_value', 'currency', 'as_of', 'cash_flows_complete', 'cash_flows', 'source_note'
]

function holdingFieldLabel(field: InvestmentDisplayField, t: (key: string) => string): string {
  switch (field) {
    case 'asset_key': return t('资产键')
    case 'name': return t('资产名称')
    case 'asset_type': return t('资产类型')
    case 'quantity': return t('数量')
    case 'quantity_kind': return t('数量口径')
    case 'cost_basis': return t('总成本')
    case 'cost_basis_kind': return t('成本口径')
    case 'market_value': return t('市值')
    case 'currency': return t('币种')
    case 'as_of': return t('数据日期')
    case 'cash_flows_complete': return t('现金流记录完整')
    case 'cash_flows': return t('现金流记录')
    case 'source_note': return t('数据来源')
  }
}

function displayHoldingValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? t('是') : t('否')
  if (Array.isArray(value)) {
    if (value.length === 0) return t('无')
    return value.map((item) => {
      if (!item || typeof item !== 'object') return String(item)
      const flow = item as { date?: unknown; kind?: unknown; amount?: unknown; currency?: unknown; included_in_market_value?: unknown }
      return [flow.date, flow.kind, `${String(flow.amount ?? '—')} ${String(flow.currency ?? '')}`.trim(), flow.included_in_market_value ? t('计入市值') : t('未计入市值')].filter(Boolean).join(' ')
    }).join('; ')
  }
  return String(value)
}

function displayProposalChangeValue(field: InvestmentDisplayField, value: unknown, t: (key: string) => string): string {
  if (field === 'cash_flows' && Array.isArray(value)) return `${value.length} ${t('条现金流')}`
  return displayHoldingValue(value, t)
}

type CloudPullStatus = 'unknown' | 'pulling' | 'synced' | 'failed'

function syncLabel(status: InvestmentPositionView['sync_status'], t: (key: string) => string): string {
  if (status === 'synced') return t('云端已同步')
  if (status === 'failed') return t('云端同步失败')
  if (status === 'pending') return t('等待云端同步')
  return t('仅保存在本机')
}

function formatMoney(value: string | null, currency: string): string {
  return value === null ? '—' : `${value} ${currency}`
}

function formatCloudPullDiagnostic(error: string, t: (key: string) => string): string {
  const separator = error.indexOf(':')
  if (separator < 0) return error
  const labels: Record<string, string> = {
    session_binding: t('会话绑定阶段'),
    positions_read: t('持仓读取阶段'),
    snapshots_read: t('快照读取阶段'),
    local_merge: t('本机合并阶段')
  }
  const phase = labels[error.slice(0, separator)]
  if (!phase) return error
  return `${t(phase)} · ${t('错误代码')}: ${error.slice(separator + 1)}`
}

export function InvestmentsPage() {
  const { t } = useLanguage()
  const addToast = useStore((state) => state.addToast)
  const [context, setContext] = useState<AgentSyncContextInfo | null>(null)
  const [positions, setPositions] = useState<InvestmentPositionView[]>([])
  const [snapshots, setSnapshots] = useState<InvestmentSnapshot[]>([])
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null)
  const [proposals, setProposals] = useState<AgentProposalPreview[]>([])
  const [syncState, setSyncState] = useState<{
    pending: number
    failed: number
    cloudPullStatus: CloudPullStatus
    cloudPullError: string | null
  }>({ pending: 0, failed: 0, cloudPullStatus: 'unknown', cloudPullError: null })
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cloudSessionNeedsLogin = /(?:^|:)(?:invalid_grant|invalid_refresh_token|refresh_token_expired)$/.test(syncState.cloudPullError || '')

  const reload = useCallback(async () => {
    const api = window.electronAgentAPI
    if (!api) {
      setError(t('Agent 持仓同步仅在桌面版可用。'))
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [contextInfo, rows, history, pending, cloudState] = await Promise.all([
        api.getContextInfo(),
        api.getPositions(),
        api.getSnapshotHistory(),
        api.listProposals(),
        api.getSyncState()
      ])
      setContext(contextInfo)
      setPositions(rows)
      setSnapshots(history)
      setProposals(pending)
      setSyncState(cloudState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    let active = true
    const initial = async () => {
      if (!active) return
      await reload()
    }
    void initial()
    const timer = window.setInterval(() => { if (active) void reload() }, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [reload])

  const handleRetry = async () => {
    const api = window.electronAgentAPI
    if (!api) return
    setRetrying(true)
    try {
      const result = await api.retrySync()
      if (!result.cloudPullSucceeded) {
        addToast('error', t('云端持仓读取失败。本机数据保留，详情见页面提示。'))
      } else {
        addToast(result.failed ? 'error' : 'success', t('同步完成：成功 {synced} 项，失败 {failed} 项。')
          .replace('{synced}', String(result.synced)).replace('{failed}', String(result.failed)))
      }
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRetrying(false)
    }
  }

  const handleApply = async (proposal: AgentProposalPreview) => {
    const api = window.electronAgentAPI
    if (!api || !proposal.operationId || !proposal.payloadHash || !proposal.baselineHash) return
    setBusyFile(proposal.fileName)
    setError(null)
    try {
      const result = await api.applyProposal(proposal.operationId, proposal.payloadHash, proposal.baselineHash)
      addToast('success', result.duplicate
        ? t('这项操作已经处理过，没有重复写入。')
        : t('已确认写入：{bills} 笔支出，{investments} 项持仓。')
          .replace('{bills}', String(result.bills)).replace('{investments}', String(result.investments)))
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      await reload()
    } finally {
      setBusyFile(null)
    }
  }

  const handleReject = async (fileName: string) => {
    const api = window.electronAgentAPI
    if (!api) return
    setBusyFile(fileName)
    try {
      await api.rejectProposal(fileName)
      addToast('info', t('提案已移入拒绝记录，没有写入数据。'))
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyFile(null)
    }
  }

  const copyContextPath = async () => {
    if (!context?.available) return
    try {
      await navigator.clipboard.writeText(context.contextPath)
      addToast('success', t('上下文文件路径已复制。'))
    } catch {
      setError(t('无法访问剪贴板，请手动复制路径。'))
    }
  }

  const openInbox = async () => {
    try { await window.electronAgentAPI?.openInbox() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const importProposalFile = async () => {
    const api = window.electronAgentAPI
    if (!api) return
    setImporting(true)
    try {
      const fileName = await api.importProposalFile()
      if (fileName) {
        addToast('success', t('提案已导入，请检查差异并逐次确认。'))
        await reload()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImporting(false)
    }
  }

  const currencies = [...new Set(positions.map((position) => position.currency))].sort()
  const activeCurrency = currencies.includes(selectedCurrency ?? '') ? selectedCurrency! : (currencies[0] ?? 'CNY')
  const currencyPositions = positions.filter((position) => position.currency === activeCurrency).sort((left, right) => {
    const leftValue = parseMarketValue(left.market_value)
    const rightValue = parseMarketValue(right.market_value)
    const leftKnown = leftValue !== null
    const rightKnown = rightValue !== null
    if (leftKnown && rightKnown && leftValue !== rightValue) return rightValue! - leftValue!
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
    return left.name.localeCompare(right.name) || left.asset_key.localeCompare(right.asset_key)
  })
  const knownValues = currencyPositions.map((position) => parseMarketValue(position.market_value))
  const knownMarketValue = knownValues.reduce<number>((sum, value) => value === null ? sum : sum + value, 0)
  const valuedPositionCount = knownValues.filter((value) => value !== null).length
  const missingValuationCount = currencyPositions.length - valuedPositionCount
  const hasCompleteValuations = currencyPositions.length > 0 && missingValuationCount === 0
  const currencyKeys = currencyPositions.map((position) => position.asset_key)
  const allocation = buildInvestmentAllocation(positions, activeCurrency)
  const trend = buildInvestmentTrend(snapshots, currencyKeys, activeCurrency)
  const returnReport = calculateInvestmentReturns(snapshots, currencyKeys)
  const historyMatchesCurrent = hasCurrentSnapshotForEveryPosition(positions, snapshots, activeCurrency)
  const portfolioReturns = historyMatchesCurrent && hasCompleteValuations ? returnReport.portfolios.find((portfolio) => portfolio.currency === activeCurrency) : undefined
  const hasHistoryForCurrent = currencyPositions.every((position) => snapshots.some((snapshot) => snapshot.asset_key === position.asset_key && snapshot.as_of === position.as_of))
  const knownCosts = currencyPositions.map(positionTotalCost)
  const hasCompleteCosts = knownCosts.length > 0 && knownCosts.every((value) => value !== null)
  const totalCost = hasCompleteCosts ? knownCosts.reduce<number>((sum, value) => sum + value!, 0) : null
  const allocationDescription = [formatMoney(knownMarketValue.toFixed(2), activeCurrency), ...allocation.map((row) => `${row.name} ${formatMoney(row.value.toFixed(2), activeCurrency)} ${row.percentage.toFixed(1)}%`)].join(' | ')

  const metricLabel = (formulaId: string) => t(formulaId === 'floating_profit'
    ? '持仓浮盈'
    : formulaId === 'daily_return' ? '日收益估算' : '累计收益估算')
  const formulaDescription = (formulaId: string) => t(formulaId === 'floating_profit'
    ? '市值 − 总成本'
    : '当期市值变化 − 外部净投入 ± 分红/费用')
  const metricReasonLabel = (reason: string) => {
    switch (reason) {
      case 'no_snapshots': return t('缺少持仓快照')
      case 'missing_market_value': return t('缺少市值')
      case 'missing_cost_basis': return t('缺少成本口径')
      case 'unknown_cost_basis_kind': return t('成本口径未知')
      case 'unknown_quantity_kind': return t('数量口径未知')
      case 'missing_comparable_snapshot': return t('缺少可比快照')
      case 'nonconsecutive_snapshot_dates': return t('快照日期不连续')
      case 'as_of_mismatch': return t('估值日期不一致')
      case 'currency_mismatch': return t('币种不一致')
      case 'cash_flow_coverage_unknown': return t('现金流记录不完整')
      case 'cash_flow_outside_interval': return t('现金流日期不在计算区间')
      case 'cash_flow_currency_mismatch': return t('现金流币种不一致')
      case 'zero_rate_denominator': return t('收益率分母为零')
      default: return t('数据不足')
    }
  }
  const renderMetric = (metric: NonNullable<typeof portfolioReturns>['floating']) => (
    <div key={metric.formula_id} className="aurora-card min-w-0 rounded-xl border p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{metricLabel(metric.formula_id)}</p>
      {metric.status === 'computed' ? (
        <>
          <p className={`mt-1 flex items-center gap-1 text-xl font-semibold tabular-nums ${Number(metric.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {Number(metric.amount) < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
            {formatMoney(metric.amount, metric.currency)}
          </p>
          {metric.rate_percent !== null && <p className="mt-1 text-xs text-gray-500">{metric.rate_percent}%</p>}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{metric.base_date ? `${metric.base_date} → ` : ''}{metric.as_of ?? t('日期未知')}</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-base font-medium text-gray-500 dark:text-gray-400">{loading ? t('正在读取…') : t('暂不可计算')}</p>
          {!loading && <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{metric.reasons.map(metricReasonLabel).join(' · ')}</p>}
        </>
      )}
      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{t('低频估算 · 来源与公式可追溯')}</p>
      <details className="mt-2 text-xs text-gray-500 dark:text-gray-400"><summary className="cursor-pointer">{t('计算口径与数据来源')}</summary>
        <p className="mt-1 break-words">{t('公式：')}{formulaDescription(metric.formula_id)}</p>
        {metric.source_notes.length > 0 ? <ul className="mt-1 list-disc space-y-1 pl-4">{metric.source_notes.map((source, index) => <li key={`${index}-${source}`} className="break-words">{source}</li>)}</ul> : <p className="mt-1">{t('没有填写数据来源')}</p>}
      </details>
    </div>
  )

  return (
    <div className="page-view w-full min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('投资持仓')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            {t('记录低频持仓快照。自动任务只整理提案；每次实际写入都需要你在此预览并确认。')}
          </p>
        </div>
        <button type="button" onClick={() => void reload()} className="aurora-button-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <RefreshCw size={15} />{t('刷新')}
        </button>
      </header>

      {!loading && proposals.length > 0 && (
        <aside data-testid="investment-pending-proposal-banner" role="status" className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border aurora-border bg-[var(--bg-card)]/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('{n} 项提案待审核').replace('{n}', String(proposals.length))}</p>
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{t('只有你确认后才会写入；请先核对提案差异。')}</p>
          </div>
          <a href="#agent-proposals-heading" className="aurora-button-primary inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium">
            {t('查看并前往审核')}
          </a>
        </aside>
      )}

      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      <section aria-labelledby="allocation-heading" className="space-y-4" data-testid="investment-dashboard">
        <section data-testid="investment-cloud-status" aria-label={t('云端同步状态')} className="aurora-card rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="rounded-lg bg-[var(--accent-dim)] p-2 text-[var(--accent)]"><Wallet size={19} /></span>
              <div className="min-w-0">
                <h2 id="allocation-heading" className="font-semibold text-gray-900 dark:text-gray-100">{t('资产配置')}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('按已记录市值展示；不含缺少估值的项目')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currencies.length > 1 && currencies.map((currency) => (
                <button key={currency} type="button" onClick={() => setSelectedCurrency(currency)} aria-pressed={activeCurrency === currency}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${activeCurrency === currency ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'aurora-border text-gray-600 dark:text-gray-300'}`}>
                  {currency}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t aurora-border pt-3">
            <div className="min-w-0 text-sm">
              {syncState.cloudPullStatus === 'pulling' && <p role="status" className="text-gray-600 dark:text-gray-300">{t('正在读取云端持仓…')}</p>}
              {syncState.cloudPullStatus === 'failed' && <p role="alert" className="text-red-700 dark:text-red-300">{t('云端读取失败；本机持仓仍可查看，云端状态未知。')}</p>}
              {syncState.cloudPullStatus === 'failed' && cloudSessionNeedsLogin && <p role="status" className="mt-1 text-amber-800 dark:text-amber-300">{t('云端登录会话已失效。请退出当前账号后重新登录；本机持仓和账单不会删除。')}</p>}
              {syncState.cloudPullStatus === 'synced' && syncState.pending === 0 && syncState.failed === 0 && <p role="status" className="text-emerald-700 dark:text-emerald-400">{t('云端持仓已同步')}</p>}
              {syncState.cloudPullStatus === 'synced' && (syncState.pending > 0 || syncState.failed > 0) && <p role="status" className="text-amber-700 dark:text-amber-300">{t('待同步 {pending} 项，失败 {failed} 项。').replace('{pending}', String(syncState.pending)).replace('{failed}', String(syncState.failed))}</p>}
              {syncState.cloudPullStatus === 'unknown' && <p role="status" className="text-gray-600 dark:text-gray-300">{t('云端同步状态未知；本机持仓仍可查看。')}</p>}
              {syncState.cloudPullError && <details className="mt-1 text-xs text-gray-500"><summary className="cursor-pointer">{t('查看错误代码')}</summary><code className="mt-1 block break-all">{formatCloudPullDiagnostic(syncState.cloudPullError, t)}</code></details>}
            </div>
            {(syncState.pending > 0 || syncState.failed > 0 || syncState.cloudPullStatus !== 'synced') && (
              <button type="button" onClick={() => void handleRetry()} disabled={retrying} className="aurora-button-secondary inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('重试云同步')}
              </button>
            )}
          </div>
        </section>

        <div className="grid min-w-0 gap-4 min-[1025px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <section className="aurora-card min-w-0 rounded-xl border p-4 sm:p-5" aria-label={t('资产类别占比图')}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('资产类别占比')}</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('币种')} · {activeCurrency}</p></div>
              {missingValuationCount > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('{n} 项缺少有效估值').replace('{n}', String(missingValuationCount))}</span>}
            </div>
            {hasCompleteValuations && allocation.length > 0 ? (
              <>
                <div data-testid="investment-allocation-content" className="mt-2 grid min-w-0 gap-2 min-[1025px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] min-[1025px]:items-center">
                  <div className="relative mx-auto h-[158px] w-full max-w-[200px] min-w-0 min-[1025px]:mx-0 min-[1025px]:max-w-none">
                    <div role="img" aria-label={t('资产类别占比图表说明：{details}').replace('{details}', allocationDescription)} className="h-full w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={allocation} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={73} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                            {allocation.map((row, index) => <Cell key={row.name} fill={INVESTMENT_COLORS[index % INVESTMENT_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(value: number, _name: string, item: { payload?: { name?: string } }) => [`${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${activeCurrency}`, item.payload?.name ?? '']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{t('组合市值')}</span>
                      <span className="max-w-[112px] truncate text-center text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(knownMarketValue.toFixed(2), activeCurrency)}</span>
                    </div>
                  </div>
                  <ul aria-label={t('资产占比明细')} className="space-y-1.5 border-t aurora-border pt-2 min-[1025px]:border-l min-[1025px]:border-t-0 min-[1025px]:pl-3 min-[1025px]:pt-0">
                    {allocation.map((row, index) => <li key={row.name} className="flex min-w-0 items-center justify-between gap-2 text-xs sm:text-sm">
                      <span className="flex min-w-0 items-center gap-2"><i aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: INVESTMENT_COLORS[index % INVESTMENT_COLORS.length] }} /><span className="truncate text-gray-700 dark:text-gray-300">{row.name}</span><span className="shrink-0 text-[10px] text-gray-400">{row.count}</span></span>
                      <span className="shrink-0 text-right tabular-nums"><b className="font-medium text-gray-900 dark:text-gray-100">{formatMoney(row.value.toFixed(2), activeCurrency)}</b><span className="ml-1.5 text-[10px] text-gray-500 sm:ml-2 sm:text-xs">{row.percentage.toFixed(1)}%</span></span>
                    </li>)}
                  </ul>
                </div>
              </>
            ) : (
              <div role={loading ? 'status' : 'note'} data-testid="investment-allocation-incomplete" className="mt-3 flex min-h-[180px] flex-col items-center justify-center rounded-lg bg-gray-50 px-5 text-center dark:bg-gray-800/50">
                {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">{t('正在读取…')}</p> : currencyPositions.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{positions.length > 0 ? t('该币种下暂无持仓。') : t('暂无可用于配置图的持仓数据。')}</p>
                ) : missingValuationCount > 0 ? (
                  <>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('{n} 项缺少有效估值').replace('{n}', String(missingValuationCount))}</p>
                    <p className="mt-2 max-w-md text-sm text-gray-600 dark:text-gray-300">{t('估值不完整，暂不展示资产占比；补充可核实的持仓市值后再汇总。')}</p>
                    {valuedPositionCount > 0 && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('当前已知市值')} · {formatMoney(knownMarketValue.toFixed(2), activeCurrency)}</p>}
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('所有持仓估值均为 0，无法形成资产占比。')}</p>
                )}
              </div>
            )}
          </section>

          <div className="grid min-w-0 gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="aurora-card min-w-0 rounded-xl border p-4"><p className="text-xs text-gray-500 dark:text-gray-400">{t(hasCompleteValuations ? '组合市值' : '当前已知市值')}</p><p className="mt-1 break-all text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{loading ? t('正在读取…') : valuedPositionCount === 0 ? '—' : formatMoney(knownMarketValue.toFixed(2), activeCurrency)}</p><p className="mt-1 text-xs text-gray-500">{loading ? '' : t('{n} 项持仓').replace('{n}', String(currencyPositions.length))}{!loading && missingValuationCount > 0 ? ` · ${t('{n} 项待估值').replace('{n}', String(missingValuationCount))}` : ''}</p></div>
              <div className="aurora-card min-w-0 rounded-xl border p-4"><p className="text-xs text-gray-500 dark:text-gray-400">{t('总成本')}</p><p className="mt-1 break-all text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{loading ? t('正在读取…') : totalCost === null ? '—' : formatMoney(totalCost.toFixed(2), activeCurrency)}</p><p className="mt-1 text-xs text-gray-500">{loading ? '' : totalCost === null ? t('部分持仓的成本口径未知') : t('成本口径完整')}</p></div>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              {portfolioReturns ? [portfolioReturns.floating, portfolioReturns.daily, portfolioReturns.cumulative].map(renderMetric) : (
                ['floating_profit', 'daily_return', 'cumulative_return'].map((formula) => <div key={formula} className="aurora-card min-w-0 rounded-xl border p-4"><p className="text-xs text-gray-500 dark:text-gray-400">{metricLabel(formula)}</p><p className="mt-2 text-base font-medium text-gray-500">{loading ? t('正在读取…') : t('暂不可计算')}</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{loading ? '' : missingValuationCount > 0 ? t('部分持仓缺少有效估值') : !hasHistoryForCurrent ? t('缺少持仓快照') : t('持仓与快照数据不一致')}</p><p className="mt-2 text-[11px] text-gray-400">{t('低频估算 · 来源与公式可追溯')}</p></div>)
              )}
            </div>
          </div>
        </div>

        <section className="aurora-card min-w-0 rounded-xl border p-4 sm:p-5" aria-label={t('历史市值趋势图')}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('历史市值趋势')}</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('只显示所有当前持仓均有记录的估值日期')}</p></div><span className="text-xs text-gray-500">{trend.length > 0 ? `${trend[0].date} → ${trend[trend.length - 1].date}` : t('暂无可比历史')}</span></div>
          {trend.length > 0 ? <div className="mt-3 h-[230px] w-full min-w-0" role="img" aria-label={t('历史市值趋势图表说明：{points}').replace('{points}', trend.map((point) => `${point.date} ${point.marketValue.toFixed(2)} ${activeCurrency}`).join(', '))}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} interval="preserveStartEnd" />
              <YAxis width={74} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
              <Tooltip formatter={(value: number) => [formatMoney(value.toFixed(2), activeCurrency), t('市值')]} />
              <Line type="monotone" dataKey="marketValue" name={t('市值')} stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--accent)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart></ResponsiveContainer>
          </div> : <div className="mt-3 flex h-[150px] items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">{loading ? t('正在读取…') : positions.length === 0 ? t('暂无可比较的持仓历史。') : t('暂无完整且可比较的估值日期。')}</div>}
        </section>

      </section>

      <section aria-labelledby="positions-heading" data-testid="investment-holdings-section">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="positions-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('当前持仓')}</h2><p className="text-sm text-gray-500">{t('{n} 项资产').replace('{n}', String(currencyPositions.length))} · {activeCurrency}</p></div></div>
        {currencyPositions.length === 0 ? <div className="aurora-card rounded-xl border p-5 text-sm text-gray-500 dark:text-gray-400">{loading ? t('正在读取…') : positions.length > 0 ? t('该币种下暂无持仓。') : syncState.cloudPullStatus === 'failed' ? t('本机暂无可显示持仓；云端状态未知。请重试云同步后再确认。') : syncState.cloudPullStatus === 'pulling' ? t('正在确认云端持仓…') : syncState.cloudPullStatus === 'synced' ? t('当前没有已同步的持仓。') : t('本机暂无持仓记录。')}</div> : <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {currencyPositions.map((position) => <article key={position.asset_key} data-testid="investment-holding-card" className="aurora-card min-w-0 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold text-gray-900 dark:text-gray-100">{position.name}</h3><p className="mt-1 break-all text-xs text-gray-500">{position.asset_type} · {position.asset_key}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${position.sync_status === 'failed' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : position.sync_status === 'synced' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{syncLabel(position.sync_status, t)}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-3"><div><p className="text-xs text-gray-500">{t('市值')}</p><p className="mt-1 break-all font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(position.market_value, position.currency)}</p></div><div><p className="text-xs text-gray-500">{t('数量')}</p><p className="mt-1 break-all font-medium tabular-nums text-gray-800 dark:text-gray-200">{position.quantity}</p></div><div><p className="text-xs text-gray-500">{t('总成本')}</p><p className="mt-1 break-all text-sm tabular-nums text-gray-700 dark:text-gray-300">{positionTotalCost(position) === null ? '—' : formatMoney(positionTotalCost(position)!.toFixed(2), position.currency)}</p></div><div><p className="text-xs text-gray-500">{t('数据日期')}</p><p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{position.as_of}</p></div></div>
            <details className="mt-3 border-t aurora-border pt-2"><summary className="cursor-pointer text-xs font-medium text-[var(--accent)]">{t('来源与同步详情')}</summary><div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400"><p className="break-words">{t('数据来源：')}{position.source_note || '—'}</p>{position.sync_error && <p className="break-words text-red-600 dark:text-red-300">{position.sync_error}</p>}</div></details>
          </article>)}
        </div>}
      </section>

      <section aria-labelledby="agent-proposals-heading" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="agent-proposals-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('等待确认的 Agent 提案')} <span className="text-sm font-normal text-gray-500">({proposals.length})</span></h2>
          <button type="button" onClick={() => void importProposalFile()} disabled={importing || !context?.available} className="aurora-button-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}{t('导入提案文件')}
          </button>
        </div>
        {loading ? (
          <div className="aurora-card rounded-xl border p-6 text-sm text-gray-500"><Loader2 className="mr-2 inline animate-spin" size={16} />{t('正在读取…')}</div>
        ) : proposals.length === 0 ? (
          <div className="aurora-card rounded-xl border p-6 text-sm text-gray-500 dark:text-gray-400">{t('目前没有待确认提案。')}</div>
        ) : proposals.map((proposal) => (
          <article key={proposal.fileName} className="aurora-card min-w-0 rounded-xl border p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {proposal.kind === 'expenses' ? t('支出提案') : proposal.kind === 'investments' ? t('持仓提案') : t('无效提案')}
                  <span className="ml-2 text-xs font-normal text-gray-500">{proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : proposal.fileName}</span>
                </h3>
              </div>
              {(proposal.kind === 'expenses' || proposal.kind === 'investments') && proposal.errors.length === 0 && (
                <span className="rounded-full bg-[var(--accent-dim)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                  {proposal.kind === 'expenses'
                    ? t('{n} 笔支出').replace('{n}', String(proposal.expenses.length))
                    : t('+{added} 新增 / {changed} 变更').replace('{added}', String(proposal.investmentDiff?.added.length ?? 0)).replace('{changed}', String(proposal.investmentDiff?.changed.length ?? 0))}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border aurora-border bg-white/70 p-3 dark:bg-gray-900/40">
              <p className="text-xs text-gray-500 dark:text-gray-400">{proposal.errors.length === 0 ? t('仅在你确认后写入。') : t('提案存在问题，修复后才能确认写入。')}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void handleReject(proposal.fileName)} disabled={busyFile === proposal.fileName} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                  <X size={14} />{t('拒绝并归档')}
                </button>
                {proposal.operationId && proposal.payloadHash && proposal.baselineHash && proposal.errors.length === 0 && (
                  <button type="button" onClick={() => void handleApply(proposal)} disabled={busyFile === proposal.fileName} className="aurora-button-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
                    {busyFile === proposal.fileName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {proposal.kind === 'expenses'
                      ? t('确认写入 {n} 笔支出').replace('{n}', String(proposal.expenses.length))
                      : (proposal.investmentDiff?.added.length ?? 0) + (proposal.investmentDiff?.changed.length ?? 0) === 0
                        ? t('确认并归档（无持仓变更）')
                        : t('确认更新 {n} 项持仓').replace('{n}', String((proposal.investmentDiff?.added.length ?? 0) + (proposal.investmentDiff?.changed.length ?? 0)))}
                  </button>
                )}
              </div>
            </div>

            {proposal.kind === 'investments' && proposal.investmentDiff && proposal.errors.length === 0 && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70" data-testid="investment-proposal-summary">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  {t('新增 {added} 项 · 更新 {changed} 项 · 保留 {kept} 项').replace('{added}', String(proposal.investmentDiff.added.length)).replace('{changed}', String(proposal.investmentDiff.changed.length)).replace('{kept}', String(proposal.investmentDiff.unmentioned.length))}
                </p>
                {(proposal.investmentDiff.added.length > 0 || proposal.investmentDiff.changed.length > 0) && <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs text-gray-700 dark:text-gray-300">
                  {proposal.investmentDiff.added.map((position) => <li key={`added-${position.asset_key}`} className="break-words">
                    <b>{position.name}</b> · {position.asset_type} · {t('数量')} {position.quantity} · {t('总成本')} {displayHoldingValue(position.cost_basis, t)} · {t('市值')} {displayHoldingValue(position.market_value, t)} {position.currency} · {position.as_of}
                  </li>)}
                  {proposal.investmentDiff.changed.map(({ before, after }) => <li key={`changed-${after.asset_key}`} className="break-words">
                    <b>{after.name}</b> · {HOLDING_FIELDS.filter((field) => before[field] !== after[field]).map((field) => `${holdingFieldLabel(field, t)} ${displayProposalChangeValue(field, before[field], t)} → ${displayProposalChangeValue(field, after[field], t)}`).join(' · ')}
                  </li>)}
                </ul>}
                {proposal.investmentDiff.added.length + proposal.investmentDiff.changed.length === 0 && <p className="mt-1 text-xs text-gray-500">{t('没有持仓字段变化；确认后只归档该提案。')}</p>}
              </div>
            )}

            {proposal.operationId && <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">{t('技术信息')}</summary><code className="mt-1 block break-all">{proposal.operationId}</code></details>}

            {proposal.errors.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">{proposal.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>}

            {proposal.kind === 'expenses' && proposal.errors.length === 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border aurora-border">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="aurora-muted text-xs"><tr><th className="px-3 py-2">{t('日期')}</th><th className="px-3 py-2">{t('金额')}</th><th className="px-3 py-2">{t('分类')}</th><th className="px-3 py-2">{t('备注')}</th></tr></thead>
                  <tbody>{proposal.expenses.map((item, index) => (
                    <tr key={`${item.date}-${index}`} className="border-t aurora-border">
                      <td className="px-3 py-2">{item.date}</td><td className="px-3 py-2">{item.amount}</td>
                      <td className="px-3 py-2">{item.category1}{item.category2 ? ` / ${item.category2}` : ''}</td>
                      <td className="max-w-80 break-words px-3 py-2">{item.note || '—'}{proposal.duplicateIndexes.includes(index) && <span className="ml-2 text-amber-700 dark:text-amber-300">{t('疑似重复')}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {proposal.kind === 'investments' && proposal.investmentDiff && proposal.errors.length === 0 && (
              <details className="mt-3 rounded-lg border aurora-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--accent)]">{t('查看完整字段差异与保留项目')}</summary>
                <div className="mt-3 space-y-3">
                {proposal.investmentDiff.added.length > 0 && <section className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('新增')} · {proposal.investmentDiff.added.length}</h4>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">{proposal.investmentDiff.added.map((position) => <dl key={position.asset_key} className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border aurora-border bg-white p-3 text-xs dark:bg-gray-900">
                    {HOLDING_FIELDS.map((field) => <div key={field} className="min-w-0"><dt className="text-gray-500">{holdingFieldLabel(field, t)}</dt><dd className="mt-0.5 break-all font-medium text-gray-800 dark:text-gray-100">{displayHoldingValue(position[field], t)}</dd></div>)}
                  </dl>)}</div>
                </section>}

                {proposal.investmentDiff.changed.length > 0 && <section className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('变更')} · {proposal.investmentDiff.changed.length}</h4>
                  <div className="mt-2 space-y-3">{proposal.investmentDiff.changed.map(({ before, after }) => <article key={after.asset_key} className="rounded-lg border aurora-border bg-white p-3 dark:bg-gray-900">
                    <h5 className="mb-2 break-all text-xs font-semibold text-gray-800 dark:text-gray-100">{after.asset_key}</h5>
                    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="aurora-muted"><tr><th className="px-2 py-1.5">{t('字段')}</th><th className="px-2 py-1.5">{t('当前值')}</th><th className="px-2 py-1.5">{t('提案值')}</th></tr></thead><tbody>{HOLDING_FIELDS.map((field) => <tr key={field} className="border-t aurora-border"><th className="px-2 py-1.5 font-medium">{holdingFieldLabel(field, t)}</th><td className="max-w-80 break-all px-2 py-1.5 text-gray-500">{displayHoldingValue(before[field], t)}</td><td className="max-w-80 break-all px-2 py-1.5 font-medium text-gray-900 dark:text-gray-100">{displayHoldingValue(after[field], t)}</td></tr>)}</tbody></table></div>
                  </article>)}</div>
                </section>}

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    [t('未变化'), proposal.investmentDiff.unchanged],
                    [t('本次未提及（保留）'), proposal.investmentDiff.unmentioned]
                  ].map(([label, rows]) => <section key={label as string} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                    <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label as string} · {(rows as InvestmentHolding[]).length}</h4>
                    {(rows as InvestmentHolding[]).length > 0 && <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">{(rows as InvestmentHolding[]).map((item) => <li key={item.asset_key} className="break-all">{item.asset_key} · {item.name} · {item.quantity} {item.currency}</li>)}</ul>}
                  </section>)}
                </div>
                </div>
              </details>
            )}
          </article>
        ))}
      </section>

      <details className="aurora-card rounded-xl border p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 font-semibold text-gray-900 dark:text-gray-100">
          <span className="rounded-lg bg-[var(--accent-dim)] p-2 text-[var(--accent)]"><ShieldCheck size={20} /></span>
          <span>{t('连接 Agent Skill')}</span>
        </summary>
        <div className="mt-3 border-t aurora-border pt-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('把上下文文件提供给你信任的 Agent。文件包含当前分类、持仓摘要和短期作用域令牌；不要公开分享。Agent 只能生成提案，不能直接改账。')}</p>
          {context?.available ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="max-w-full break-all rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{context.contextPath}</code>
              <button type="button" onClick={() => void copyContextPath()} className="aurora-button-secondary inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
                <Clipboard size={13} />{t('复制路径')}
              </button>
              <button type="button" onClick={() => void openInbox()} className="aurora-button-secondary inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
                <FolderOpen size={13} />{t('打开提案目录')}
              </button>
              {context.expiresAt && <span className="text-xs text-gray-500">{t('有效期至')} {new Date(context.expiresAt).toLocaleDateString()}</span>}
            </div>
          ) : <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{context?.reason || t('正在读取当前登录状态…')}</p>}
          {context?.available && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('提案目录：')}<code className="break-all">{context.inboxPath}</code></p>}
        </div>
      </details>

    </div>
  )
}
