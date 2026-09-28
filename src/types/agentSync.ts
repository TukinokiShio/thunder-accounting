import type { InvestmentDiff, InvestmentHolding } from '../utils/investmentHoldings'
import type { InvestmentSnapshot } from '../utils/investmentReturns'

export interface AgentExpenseItem {
  amount: number
  category1: string
  category2: string
  date: string
  note: string
}

export interface AgentProposalProvenance {
  skill_name: 'thunder-expense-entry' | 'thunder-investment-snapshot'
  skill_version: string
  source_summary: string
}

export interface AgentProposalPreview {
  fileName: string
  operationId: string | null
  payloadHash: string | null
  baselineHash: string | null
  kind: 'expenses' | 'investments' | 'invalid'
  createdAt: string | null
  provenance: AgentProposalProvenance | null
  expenses: AgentExpenseItem[]
  duplicateIndexes: number[]
  investmentDiff: InvestmentDiff | null
  errors: string[]
  alreadyApplied: boolean
}

export interface AgentSyncContextInfo {
  available: boolean
  inboxPath: string
  contextPath: string
  expiresAt: string | null
  reason?: string
}

export interface InvestmentPositionView extends InvestmentHolding {
  id: number
  cloud_id: string | null
  created_at: string
  updated_at: string
  sync_status: 'pending' | 'synced' | 'failed' | 'local'
  sync_error: string | null
}

export interface AgentSyncAPI {
  getContextInfo: () => Promise<AgentSyncContextInfo>
  listProposals: () => Promise<AgentProposalPreview[]>
  applyProposal: (operationId: string, payloadHash: string, baselineHash: string) => Promise<{ duplicate: boolean; bills: number; investments: number }>
  rejectProposal: (fileName: string) => Promise<void>
  importProposalFile: () => Promise<string | null>
  openInbox: () => Promise<void>
  getPositions: () => Promise<InvestmentPositionView[]>
  getSnapshotHistory: () => Promise<InvestmentSnapshot[]>
  getSyncState: () => Promise<{
    pending: number
    failed: number
    cloudPullStatus: 'unknown' | 'pulling' | 'synced' | 'failed'
    cloudPullError: string | null
  }>
  retrySync: () => Promise<{ attempted: number; synced: number; failed: number; cloudPullSucceeded: boolean }>
}

declare global {
  interface Window {
    electronAgentAPI?: AgentSyncAPI
  }
}
