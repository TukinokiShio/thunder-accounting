import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('puts allocation before proposal work, shows holding cards and a common-date trend', async () => {
    render(<InvestmentsPage />)

    expect(await screen.findByText('资产配置')).toBeInTheDocument()
    expect(screen.getByText('基金')).toBeInTheDocument()
    expect(screen.getAllByText('120.00 CNY').length).toBeGreaterThan(1)
    expect(screen.getByText('历史市值趋势')).toBeInTheDocument()
    expect(screen.getByText('20 CNY')).toBeInTheDocument()
    expect(screen.getAllByText('10 CNY').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('investment-holding-card')).toHaveTextContent('基金 A')
    expect(screen.getByText('云端持仓已同步')).toBeInTheDocument()
    expect((window as any).electronAgentAPI.getSnapshotHistory).toHaveBeenCalledTimes(1)

    const dashboard = screen.getByTestId('investment-dashboard')
    expect(dashboard.compareDocumentPosition(screen.getByText('等待确认的 Agent 提案')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入提案文件' }))
    await waitFor(() => expect((window as any).electronAgentAPI.importProposalFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('success', '提案已导入，请检查差异并逐次确认。'))
  })

  it('keeps absent return data explicitly uncomputable and exposes cloud pull failures', async () => {
    ;(window as any).electronAgentAPI.getPositions.mockResolvedValueOnce([makePosition({ sync_status: 'failed', sync_error: 'migration_required' })])
    ;(window as any).electronAgentAPI.getSnapshotHistory.mockResolvedValueOnce([])
    ;(window as any).electronAgentAPI.getSyncState.mockResolvedValueOnce({ pending: 1, failed: 1, cloudPullStatus: 'failed', cloudPullError: 'migration_required' })
    render(<InvestmentsPage />)

    await screen.findByTestId('investment-holding-card')
    expect(screen.getByTestId('investment-dashboard').textContent).toContain('暂不可计算')
    expect(screen.getByRole('alert')).toHaveTextContent('云端持仓读取失败')
    expect(screen.getAllByText('缺少持仓快照').length).toBeGreaterThan(0)
    expect(screen.getByTestId('investment-holding-card')).toHaveTextContent('云端同步失败')
  })
})
