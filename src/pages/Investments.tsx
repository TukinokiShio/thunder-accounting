import { useCallback, useEffect, useState } from 'react'
import { Check, Clipboard, FolderOpen, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useLanguage } from '@/i18n/LanguageContext'
import { useStore } from '@/store'
import type { AgentProposalPreview, AgentSyncContextInfo, InvestmentPositionView } from '@/types/agentSync'
import type { InvestmentHolding } from '@/utils/investmentHoldings'

const HOLDING_FIELDS: Array<keyof InvestmentHolding> = [
  'asset_key', 'name', 'asset_type', 'quantity', 'cost_basis', 'market_value', 'currency', 'as_of', 'source_note'
]

function holdingFieldLabel(field: keyof InvestmentHolding, t: (key: string) => string): string {
  switch (field) {
    case 'asset_key': return t('资产键')
    case 'name': return t('资产名称')
    case 'asset_type': return t('资产类型')
    case 'quantity': return t('数量')
    case 'cost_basis': return t('总成本')
    case 'market_value': return t('市值')
    case 'currency': return t('币种')
    case 'as_of': return t('数据日期')
    case 'source_note': return t('数据来源')
  }
}

function displayHoldingValue(value: string | null): string {
  return value === null ? '—' : value
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

export function InvestmentsPage() {
  const { t } = useLanguage()
  const addToast = useStore((state) => state.addToast)
  const [context, setContext] = useState<AgentSyncContextInfo | null>(null)
  const [positions, setPositions] = useState<InvestmentPositionView[]>([])
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
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const api = window.electronAgentAPI
    if (!api) {
      setError(t('Agent 持仓同步仅在桌面版可用。'))
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [contextInfo, rows, pending, cloudState] = await Promise.all([
        api.getContextInfo(),
        api.getPositions(),
        api.listProposals(),
        api.getSyncState()
      ])
      setContext(contextInfo)
      setPositions(rows)
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

      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      <section className="aurora-card rounded-xl border p-4 sm:p-5" aria-labelledby="investment-agent-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[var(--accent-dim)] p-2 text-[var(--accent)]"><ShieldCheck size={20} /></div>
          <div className="min-w-0 flex-1">
            <h2 id="investment-agent-heading" className="font-semibold text-gray-900 dark:text-gray-100">{t('连接 Agent Skill')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('把上下文文件提供给你信任的 Agent。文件包含当前分类、持仓摘要和短期作用域令牌；不要公开分享。Agent 只能生成提案，不能直接改账。')}
            </p>
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
        </div>
      </section>

      <section aria-labelledby="agent-proposals-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="agent-proposals-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('等待确认的 Agent 提案')} <span className="text-sm font-normal text-gray-500">({proposals.length})</span></h2>
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
                {proposal.operationId && <p className="mt-1 break-all text-xs text-gray-400">ID: {proposal.operationId}</p>}
              </div>
              {(proposal.kind === 'expenses' || proposal.kind === 'investments') && proposal.errors.length === 0 && (
                <span className="rounded-full bg-[var(--accent-dim)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                  {proposal.kind === 'expenses'
                    ? t('{n} 笔支出').replace('{n}', String(proposal.expenses.length))
                    : t('+{added} 新增 / {changed} 变更').replace('{added}', String(proposal.investmentDiff?.added.length ?? 0)).replace('{changed}', String(proposal.investmentDiff?.changed.length ?? 0))}
                </span>
              )}
            </div>

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
              <div className="mt-3 space-y-3">
                {proposal.investmentDiff.added.length > 0 && <section className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('新增')} · {proposal.investmentDiff.added.length}</h4>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">{proposal.investmentDiff.added.map((position) => <dl key={position.asset_key} className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border aurora-border bg-white p-3 text-xs dark:bg-gray-900">
                    {HOLDING_FIELDS.map((field) => <div key={field} className="min-w-0"><dt className="text-gray-500">{holdingFieldLabel(field, t)}</dt><dd className="mt-0.5 break-all font-medium text-gray-800 dark:text-gray-100">{displayHoldingValue(position[field])}</dd></div>)}
                  </dl>)}</div>
                </section>}

                {proposal.investmentDiff.changed.length > 0 && <section className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('变更')} · {proposal.investmentDiff.changed.length}</h4>
                  <div className="mt-2 space-y-3">{proposal.investmentDiff.changed.map(({ before, after }) => <article key={after.asset_key} className="rounded-lg border aurora-border bg-white p-3 dark:bg-gray-900">
                    <h5 className="mb-2 break-all text-xs font-semibold text-gray-800 dark:text-gray-100">{after.asset_key}</h5>
                    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="aurora-muted"><tr><th className="px-2 py-1.5">{t('字段')}</th><th className="px-2 py-1.5">{t('当前值')}</th><th className="px-2 py-1.5">{t('提案值')}</th></tr></thead><tbody>{HOLDING_FIELDS.map((field) => <tr key={field} className="border-t aurora-border"><th className="px-2 py-1.5 font-medium">{holdingFieldLabel(field, t)}</th><td className="max-w-80 break-all px-2 py-1.5 text-gray-500">{displayHoldingValue(before[field])}</td><td className="max-w-80 break-all px-2 py-1.5 font-medium text-gray-900 dark:text-gray-100">{displayHoldingValue(after[field])}</td></tr>)}</tbody></table></div>
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
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
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
          </article>
        ))}
      </section>

      <section aria-labelledby="positions-heading" className="aurora-card rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="positions-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('当前持仓')}</h2><p className="text-sm text-gray-500">{t('{n} 项资产').replace('{n}', String(positions.length))}</p></div>
          {(syncState.pending > 0 || syncState.failed > 0 || syncState.cloudPullStatus === 'failed') && <button type="button" onClick={() => void handleRetry()} disabled={retrying} className="aurora-button-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50">{retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('重试云同步')}</button>}
        </div>
        {syncState.cloudPullStatus === 'pulling' && <p role="status" className="mt-3 text-sm text-gray-500">{t('正在读取云端持仓…')}</p>}
        {syncState.cloudPullStatus === 'failed' && <p role="alert" className="mt-3 break-words text-sm text-red-700 dark:text-red-300">{t('云端持仓读取失败。本机数据保留，尚不能确认云端是否为空。')} {syncState.cloudPullError}</p>}
        {(syncState.pending > 0 || syncState.failed > 0) && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t('待同步 {pending} 项，失败 {failed} 项。').replace('{pending}', String(syncState.pending)).replace('{failed}', String(syncState.failed))}</p>}
        {positions.length === 0 ? <p className="mt-4 text-sm text-gray-500">{t('暂无持仓。使用投资 Skill 生成第一份快照提案。')}</p> : (
          <div className="mt-4 overflow-x-auto rounded-lg border aurora-border">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="aurora-muted text-xs"><tr><th className="px-3 py-2">{t('资产')}</th><th className="px-3 py-2">{t('数量')}</th><th className="px-3 py-2">{t('总成本')}</th><th className="px-3 py-2">{t('市值')}</th><th className="px-3 py-2">{t('数据日期')}</th><th className="px-3 py-2">{t('同步状态')}</th></tr></thead>
              <tbody>{positions.map((position) => <tr key={position.asset_key} className="border-t aurora-border align-top">
                <td className="px-3 py-3"><div className="font-medium text-gray-900 dark:text-gray-100">{position.name}</div><div className="mt-0.5 text-xs text-gray-500">{position.asset_key} · {position.asset_type}</div></td>
                <td className="px-3 py-3 tabular-nums">{position.quantity}</td><td className="px-3 py-3 tabular-nums">{formatMoney(position.cost_basis, position.currency)}</td><td className="px-3 py-3 tabular-nums">{formatMoney(position.market_value, position.currency)}</td>
                <td className="px-3 py-3">{position.as_of}</td><td className="px-3 py-3"><span className={position.sync_status === 'failed' ? 'text-red-600' : position.sync_status === 'synced' ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}>{syncLabel(position.sync_status, t)}</span>{position.sync_error && <p className="mt-1 max-w-48 break-words text-xs text-red-600" title={position.sync_error}>{position.sync_error}</p>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
