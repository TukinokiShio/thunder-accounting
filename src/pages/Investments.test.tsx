import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { InvestmentsPage } from './Investments'
import { useStore } from '@/store'

const mockAddToast = vi.fn()

vi.mock('@/i18n/LanguageContext', () => {
  const t = (key: string) => key
  return { useLanguage: () => ({ t, language: 'zh', setLanguage: vi.fn() }) }
})

const makePosition = (overrides: Record<string, unknown> = {}) => ({
  id: 1, cloud_id: 'cloud-1', created_at: '2026-09-28', updated_at: '2026-09-28',
  sync_status: 'synced', sync_error: null,
  asset_key: 'CNY:FUND:A', name: '基金 A', asset_type: '基金', quantity: '10',
  cost_basis: '100', cost_basis_kind: 'total', market_value: '120', currency: 'CNY',
  quantity_kind: 'shares', as_of: '2026-09-28', source_note: '对账单',
  cash_flows: [], cash_flows_complete: true, ...overrides
})

const makeSnapshot = (overrides: Record<string, unknown> = {}) => ({
  asset_key: 'CNY:FUND:A', name: '基金 A', asset_type: '基金', quantity: '10',
  cost_basis: '100', cost_basis_kind: 'total', market_value: '120', currency: 'CNY',
  quantity_kind: 'shares', as_of: '2026-09-28', source_note: '对账单',
  cash_flows: [], cash_flows_complete: true, operation_id: 'op-1', recorded_at: '2026-09-28T08:00:00Z',
  ...overrides
})

describe('Investments page asset-allocation direction', () => {
  beforeEach(() => {
    mockAddToast.mockClear()
    useStore.setState({ addToast: mockAddToast } as never)
    ;(window as any).electronAgentAPI = {
      getContextInfo: vi.fn().mockResolvedValue({ available: true, contextPath: 'synthetic/context.json', inboxPath: 'synthetic/inbox', expiresAt: '2026-10-01' }),
      getPositions: vi.fn().mockResolvedValue([makePosition()]),
      getSnapshotHistory: vi.fn().mockResolvedValue([
        makeSnapshot({ as_of: '2026-09-27', market_value: '110' }), makeSnapshot()
      ]),
      listProposals: vi.fn().mockResolvedValue([]),
      getSyncState: vi.fn().mockResolvedValue({ pending: 0, failed: 0, cloudPullStatus: 'synced', cloudPullError: null }),
      retrySync: vi.fn(), applyProposal: vi.fn(), rejectProposal: vi.fn(), openInbox: vi.fn(), importProposalFile: vi.fn().mockResolvedValue('synthetic-operation.json')
    }
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows the allocation chart before the holdings list and proposal work', async () => {
    render(<InvestmentsPage />)

    expect(await screen.findByText('资产配置')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /资产类别占比图表说明/ })).toBeVisible()
    expect(within(screen.getByRole('region', { name: '资产类别占比图' })).getByRole('img', { name: /120\.00 CNY/ })).toBeVisible()
    expect(screen.getByText('基金')).toBeInTheDocument()
    expect(screen.getAllByText('120.00 CNY').length).toBeGreaterThan(1)
    expect(screen.getByText('历史市值趋势')).toBeInTheDocument()
    expect(screen.getByText('20 CNY')).toBeInTheDocument()
    expect(screen.getAllByText('10 CNY').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('investment-holding-card')).toHaveTextContent('基金 A')
    expect(screen.getByText('云端持仓已同步')).toBeInTheDocument()
    expect((window as any).electronAgentAPI.getSnapshotHistory).toHaveBeenCalledTimes(1)

    expect(screen.getByTestId('investment-dashboard').compareDocumentPosition(screen.getByTestId('investment-holdings-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const dashboard = screen.getByTestId('investment-dashboard')
    expect(dashboard.compareDocumentPosition(screen.getByText('等待确认的 Agent 提案')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入提案文件' }))
    await waitFor(() => expect((window as any).electronAgentAPI.importProposalFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('success', '提案已导入，请检查差异并逐次确认。'))
  })

  it('keeps known value visible but hides partial category shares when positions are unvalued', async () => {
    const valued = [
      makePosition({ asset_key: 'CNY:FUND:VALUED', name: '有估值基金', asset_type: '基金', market_value: '120' }),
      makePosition({ asset_key: 'CNY:GOLD:VALUED', name: '有估值黄金', asset_type: '黄金 ETF', market_value: '80' })
    ]
    const unvalued = Array.from({ length: 6 }, (_, index) => makePosition({
      id: index + 3,
      asset_key: `CNY:UNVALUED:${index}`,
      name: `待估值 ${index + 1}`,
      market_value: null
    }))
    ;(window as any).electronAgentAPI.getPositions.mockResolvedValueOnce([...valued, ...unvalued])
    ;(window as any).electronAgentAPI.getSnapshotHistory.mockResolvedValueOnce([])
    render(<InvestmentsPage />)

    const card = screen.getByRole('region', { name: '资产类别占比图' })
    expect(await within(card).findAllByText('6 项缺少有效估值')).toHaveLength(2)
    expect(within(card).getByText(/估值不完整，暂不展示资产占比/)).toBeVisible()
    expect(within(card).getByText(/200\.00 CNY/)).toBeVisible()
    expect(within(card).queryByRole('list', { name: '资产占比明细' })).not.toBeInTheDocument()
    expect(within(card).queryByTestId('investment-allocation-content')).not.toBeInTheDocument()
    expect(within(card).queryByText(/100\.0%/)).not.toBeInTheDocument()
  })

  it('keeps absent return data explicitly uncomputable and exposes cloud pull failures', async () => {
    ;(window as any).electronAgentAPI.getPositions.mockResolvedValueOnce([makePosition({ sync_status: 'failed', sync_error: 'migration_required' })])
    ;(window as any).electronAgentAPI.getSnapshotHistory.mockResolvedValueOnce([])
    ;(window as any).electronAgentAPI.getSyncState.mockResolvedValueOnce({ pending: 1, failed: 1, cloudPullStatus: 'failed', cloudPullError: 'migration_required' })
    render(<InvestmentsPage />)

    await screen.findByTestId('investment-holding-card')
    expect(screen.getByTestId('investment-dashboard').textContent).toContain('暂不可计算')
    expect(screen.getByRole('alert')).toHaveTextContent('云端读取失败')
    expect(screen.getAllByText('缺少持仓快照').length).toBeGreaterThan(0)
    expect(screen.getByTestId('investment-holding-card')).toHaveTextContent('云端同步失败')
  })

  it('sorts visible positions by value and keeps unvalued positions at the bottom', async () => {
    ;(window as any).electronAgentAPI.getPositions.mockResolvedValueOnce([
      makePosition({ asset_key: 'CNY:FUND:C', name: '无估值', market_value: null }),
      makePosition({ asset_key: 'CNY:FUND:A', name: '低市值', market_value: '50' }),
      makePosition({ asset_key: 'CNY:FUND:B', name: '高市值', market_value: '120' })
    ])
    render(<InvestmentsPage />)

    const cards = await screen.findAllByTestId('investment-holding-card')
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['高市值', '低市值', '无估值'])
    expect(screen.getByTestId('investment-dashboard').compareDocumentPosition(screen.getByTestId('investment-holdings-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not claim the account is empty when local holdings are absent and cloud sync failed', async () => {
    ;(window as any).electronAgentAPI.getPositions.mockResolvedValueOnce([])
    ;(window as any).electronAgentAPI.getSnapshotHistory.mockResolvedValueOnce([])
    ;(window as any).electronAgentAPI.getSyncState.mockResolvedValueOnce({ pending: 0, failed: 0, cloudPullStatus: 'failed', cloudPullError: 'cloud_session_rejected:token_expired' })
    render(<InvestmentsPage />)

    expect(await screen.findByText('本机暂无可显示持仓；云端状态未知。请重试云同步后再确认。')).toBeInTheDocument()
    expect(screen.queryByText('暂无持仓。使用投资 Skill 生成第一份快照提案。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试云同步' })).toBeInTheDocument()
    const errorDetails = screen.getByText('查看错误代码').closest('details')!
    expect(errorDetails).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('查看错误代码'))
    expect(screen.getByText('cloud_session_rejected:token_expired')).toBeVisible()
  })

  it('shows a safe cloud failure phase beside the machine code', async () => {
    ;(window as any).electronAgentAPI.getSyncState.mockResolvedValueOnce({ pending: 0, failed: 0, cloudPullStatus: 'failed', cloudPullError: 'positions_read:cloud_unknown_error' })
    render(<InvestmentsPage />)

    expect(await screen.findByRole('alert')).toBeVisible()
    fireEvent.click(screen.getByText('查看错误代码'))
    expect(screen.getByText('持仓读取阶段 · 错误代码: cloud_unknown_error')).toBeVisible()
  })

  it('explains that invalid_grant needs a fresh login while local holdings remain available', async () => {
    ;(window as any).electronAgentAPI.getSyncState.mockResolvedValueOnce({
      pending: 0, failed: 0, cloudPullStatus: 'failed', cloudPullError: 'session_binding:cloud_session_rejected:invalid_grant'
    })
    render(<InvestmentsPage />)

    expect(await screen.findByText('云端登录会话已失效。请退出当前账号后重新登录；本机持仓和账单不会删除。')).toBeVisible()
    expect(screen.getByText('云端读取失败；本机持仓仍可查看，云端状态未知。')).toBeVisible()
  })

  it('puts proposal confirmation before the collapsed technical holding diff', async () => {
    ;(window as any).electronAgentAPI.listProposals.mockResolvedValueOnce([{
      fileName: 'synthetic-investment.json', operationId: 'synthetic-op', payloadHash: 'hash-a', baselineHash: 'hash-b',
      kind: 'investments', createdAt: '2026-09-28T10:00:00.000Z', provenance: null, expenses: [], duplicateIndexes: [],
      investmentDiff: { added: [makePosition()], changed: [], unchanged: [], unmentioned: [] }, errors: [], alreadyApplied: false
    }])
    render(<InvestmentsPage />)

    const summary = await screen.findByTestId('investment-proposal-summary')
    const proposal = summary.closest('article')!
    const confirm = within(proposal).getByRole('button', { name: '确认更新 1 项持仓' })
    const detailSummary = within(proposal).getByText('查看完整字段差异与保留项目')
    expect(confirm.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(detailSummary.closest('details')).not.toHaveAttribute('open')
  })
})
