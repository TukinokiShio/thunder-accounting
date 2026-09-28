import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, lstat, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  computeInvestmentDiff,
  validateInvestmentBatch,
  type InvestmentHolding
} from '../src/utils/investmentHoldings'
import type { InvestmentSnapshot } from '../src/utils/investmentReturns'
import type { AgentExpenseItem, AgentProposalPreview, AgentProposalProvenance } from '../src/types/agentSync'
import type { BillRow } from './database/index'

const MAX_PROPOSAL_BYTES = 1024 * 1024
const MAX_PROPOSAL_ITEMS = 200
const SCOPE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PROPOSAL_SCHEMA = 'thunder-agent-proposal/v1'

export interface AgentCategory {
  name: string
  children: string
  type: string
}

export interface AgentBill {
  amount: number
  category1: string
  category2: string
  date: string
  note: string
}

export interface AgentOperationRecord {
  payload_hash: string
  operation_type: string
}

export interface AgentSyncDependencies {
  getSessionUserId: () => string | null
  getDatabaseUserId: () => string | null
  getExpenseCategories: () => AgentCategory[]
  getBills: () => AgentBill[]
  getInvestments: () => InvestmentHolding[]
  getInvestmentSnapshotHistory: () => InvestmentSnapshot[]
  getOperation: (operationId: string) => AgentOperationRecord | null
  applyExpenses: (operationId: string, payloadHash: string, rows: AgentExpenseItem[]) => BillRow[]
  onExpensesApplied?: (rows: BillRow[]) => void
  applyInvestments: (operationId: string, payloadHash: string, rows: InvestmentHolding[]) => number
}

interface PersistedScope {
  token: string
  expiresAt: number
}

interface ProposalEnvelope {
  schema_version: typeof PROPOSAL_SCHEMA
  operation_id: string
  scope_token: string
  created_at: string
  kind: 'expenses' | 'investments'
  items: unknown[]
  skill_name?: AgentProposalProvenance['skill_name']
  skill_version?: string
  source_summary?: string
}

interface ValidatedProposal {
  envelope: ProposalEnvelope
  payloadHash: string
  baselineHash: string
  view: AgentProposalPreview
}

/**
 * The Agent only writes bounded JSON files. This service binds them to the live
 * Electron session, prepares a read-only preview, and writes only after an
 * explicit renderer confirmation.
 */
export class AgentSyncService {
  private readonly root: string
  private readonly scopeDir: string
  private readonly accountsDir: string
  private activeUserId: string | null = null
  private activeScope: PersistedScope | null = null

  constructor(userDataPath: string, private readonly deps: AgentSyncDependencies) {
    this.root = path.resolve(userDataPath, 'agent-sync')
    this.scopeDir = path.join(this.root, 'scopes')
    this.accountsDir = path.join(this.root, 'accounts')
  }

  async activate(userId: string, restore = false): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error('agent_account_scope_invalid')
    if (this.activeUserId && this.activeUserId !== userId) {
      await this.rotatePersistedScope(this.activeUserId)
      await this.scrubContext(this.activeUserId)
    } else if (!this.activeUserId) {
      await this.invalidateOtherAccounts(userId)
    }

    this.activeUserId = userId
    if (restore) {
      const persisted = await this.readPersistedScope(userId)
      this.activeScope = persisted && persisted.expiresAt > Date.now()
        ? persisted
        : this.newScope()
    } else {
      this.activeScope = this.newScope()
    }
    await this.writePersistedScope(userId, this.activeScope)
  }

  async invalidate(): Promise<void> {
    const userId = this.activeUserId
    if (userId) {
      await this.rotatePersistedScope(userId)
      await this.scrubContext(userId)
    }
    this.activeUserId = null
    this.activeScope = null
  }

  /** Clear stale file capabilities when startup confirms there is no restored session. */
  async invalidateAll(): Promise<void> {
    await this.ensureDirectories(null)
    const scopeFiles = await readdir(this.scopeDir, { withFileTypes: true })
    for (const entry of scopeFiles) {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/i.test(entry.name)) continue
      await this.atomicWrite(path.join(this.scopeDir, entry.name), JSON.stringify(this.newScope()))
    }
    const accounts = await readdir(this.accountsDir, { withFileTypes: true })
    for (const entry of accounts) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/i.test(entry.name)) continue
      const accountRoot = path.join(this.accountsDir, entry.name)
      const scopedRoot = path.join(accountRoot, 'agent-sync')
      const accountInfo = await lstat(accountRoot)
      if (!accountInfo.isDirectory() || accountInfo.isSymbolicLink()) continue
      try {
        const scopedInfo = await lstat(scopedRoot)
        if (!scopedInfo.isDirectory() || scopedInfo.isSymbolicLink()) continue
      } catch { continue }
      const scopedReal = await import('node:fs/promises').then(({ realpath }) => realpath(scopedRoot))
      const rootReal = await import('node:fs/promises').then(({ realpath }) => realpath(this.root))
      if (!isWithin(rootReal, scopedReal)) continue
      const contextPath = path.join(scopedRoot, 'context.json')
      await this.atomicWrite(contextPath, this.scrubbedContext())
    }
    this.activeUserId = null
    this.activeScope = null
  }

  private async invalidateOtherAccounts(currentUserId: string): Promise<void> {
    await this.ensureDirectories(null)
    const currentKey = this.accountKey(currentUserId)
    const scopeFiles = await readdir(this.scopeDir, { withFileTypes: true })
    for (const entry of scopeFiles) {
      const match = /^([0-9a-f]{64})\.json$/i.exec(entry.name)
      if (!entry.isFile() || !match || match[1].toLowerCase() === currentKey) continue
      await this.atomicWrite(path.join(this.scopeDir, entry.name), JSON.stringify(this.newScope()))
    }
    const accounts = await readdir(this.accountsDir, { withFileTypes: true })
    for (const entry of accounts) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/i.test(entry.name) || entry.name.toLowerCase() === currentKey) continue
      const accountRoot = path.join(this.accountsDir, entry.name)
      const scopedRoot = path.join(accountRoot, 'agent-sync')
      const accountInfo = await lstat(accountRoot)
      if (!accountInfo.isDirectory() || accountInfo.isSymbolicLink()) continue
      try {
        const scopedInfo = await lstat(scopedRoot)
        if (!scopedInfo.isDirectory() || scopedInfo.isSymbolicLink()) continue
      } catch { continue }
      const contextPath = path.join(scopedRoot, 'context.json')
      await this.atomicWrite(contextPath, this.scrubbedContext())
    }
  }

  async getContextInfo(): Promise<{
    available: boolean
    inboxPath: string
    contextPath: string
    expiresAt: string | null
    reason?: string
  }> {
    const scope = await this.requireScope()
    if (!scope) {
      return {
        available: false,
        inboxPath: '',
        contextPath: '',
        expiresAt: null,
        reason: '请先登录雷霆记账桌面端。'
      }
    }

    const paths = this.accountPaths(this.activeUserId!)
    await this.ensureDirectories(this.activeUserId)
    const categories = this.deps.getExpenseCategories().map((category) => {
      let children: string[] = []
      try {
        const parsed: unknown = JSON.parse(category.children)
        if (Array.isArray(parsed)) children = parsed.filter((value): value is string => typeof value === 'string')
      } catch { /* malformed local category is omitted from the Agent context */ }
      return { name: category.name, children }
    })
    const holdings = this.deps.getInvestments()
    const context = {
      schema_version: 'thunder-agent-context/v1',
      expires_at: new Date(scope.expiresAt).toISOString(),
      scope_token: scope.token,
      expense_categories: categories,
      investment_holdings: holdings,
      investment_snapshot_history: this.deps.getInvestmentSnapshotHistory()
    }
    await this.atomicWrite(paths.contextPath, JSON.stringify(context, null, 2))

    return {
      available: true,
      inboxPath: paths.inbox,
      contextPath: paths.contextPath,
      expiresAt: new Date(scope.expiresAt).toISOString()
    }
  }

  async listProposals(): Promise<AgentProposalPreview[]> {
    if (!(await this.requireScope())) return []
    const paths = this.accountPaths(this.activeUserId!)
    await this.ensureDirectories(this.activeUserId)
    const entries = await readdir(paths.inbox, { withFileTypes: true })
    const jsonEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    if (jsonEntries.length > MAX_PROPOSAL_ITEMS) {
      return [this.invalidPreview('', `Inbox 最多允许 ${MAX_PROPOSAL_ITEMS} 个 JSON 提案，请先处理现有文件。`)]
    }

    const views: AgentProposalPreview[] = []
    for (const entry of jsonEntries) {
      const fileName = entry.name
      try {
        if (!entry.isFile()) throw new Error('提案必须是 inbox 中的直属普通文件。')
        const filePath = path.join(paths.inbox, fileName)
        const receipt = await this.readReceipt(filePath, fileName)
        if (receipt) {
          const directory = receipt.state === 'rejected' ? paths.rejected : paths.processed
          if (receipt.state === 'processed') {
            const operation = this.deps.getOperation(receipt.operation_id)
            if (!operation || operation.payload_hash !== receipt.payload_hash) throw new Error('提案回执与当前账号操作账本不匹配。')
          }
          await rename(filePath, path.join(directory, `${receipt.operation_id}-${randomUUID()}.json`))
          continue
        }
        const validated = await this.readAndValidate(fileName)
        const existing = this.deps.getOperation(validated.envelope.operation_id)
        if (existing) {
          if (existing.payload_hash === validated.payloadHash) {
            await this.archiveProposal(fileName, 'processed', validated.envelope.operation_id, validated.payloadHash, validated.envelope.kind, 0, 0, validated.view.provenance)
            continue
          }
          throw new Error('此 operation_id 已用于其他内容，拒绝冲突提案。')
        }
        views.push(validated.view)
      } catch (error) {
        views.push(this.invalidPreview(fileName, safeMessage(error)))
      }
    }
    return views.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  }

  /** Copy a user-selected JSON proposal into the current account's managed inbox. */
  async importProposalFile(sourcePath: string): Promise<string> {
    const scope = await this.requireScope()
    if (!scope) throw new Error('agent_session_required')
    const paths = this.accountPaths(this.activeUserId!)
    await this.ensureDirectories(this.activeUserId)
    const existingFiles = await readdir(paths.inbox, { withFileTypes: true })
    if (existingFiles.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json')).length >= MAX_PROPOSAL_ITEMS) {
      throw new Error(`Inbox 最多允许 ${MAX_PROPOSAL_ITEMS} 个 JSON 提案，请先处理现有文件。`)
    }

    const before = await lstat(sourcePath)
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('导入文件必须是普通 JSON 文件，不能是链接。')
    if (before.size <= 0 || before.size > MAX_PROPOSAL_BYTES) throw new Error('提案文件为空或超过 1 MiB 限制。')
    const handle = await open(sourcePath, constants.O_RDONLY)
    let raw: string
    try {
      const opened = await handle.stat()
      const after = await lstat(sourcePath)
      if (!opened.isFile() || opened.size !== before.size || opened.ino !== after.ino || opened.dev !== after.dev || after.isSymbolicLink()) {
        throw new Error('提案文件在读取期间发生变化，已拒绝读取。')
      }
      if (opened.size > MAX_PROPOSAL_BYTES) throw new Error('提案文件超过 1 MiB 限制。')
      raw = await handle.readFile({ encoding: 'utf8' })
    } finally {
      await handle.close()
    }

    let operationId: string | null = null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isPlainRecord(parsed) && typeof parsed.operation_id === 'string' && isUuid(parsed.operation_id)) {
        operationId = parsed.operation_id
      }
    } catch { /* Keep malformed JSON in the managed inbox so the preview can explain the error. */ }
    const fileName = `${operationId ?? randomUUID()}.json`
    const target = path.join(paths.inbox, fileName)
    try {
      await writeFile(target, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (isAlreadyExists(error)) throw new Error('该操作编号已在提案目录中，请先刷新列表。')
      throw error
    }
    return fileName
  }

  async applyProposal(operationId: string, payloadHash: string, baselineHash: string): Promise<{
    duplicate: boolean
    bills: number
    investments: number
  }> {
    const scope = await this.requireScope()
    if (!scope) throw new Error('agent_session_required')
    if (!isUuid(operationId) || !isSha256(payloadHash) || !isSha256(baselineHash)) {
      throw new Error('agent_proposal_reference_invalid')
    }

    const fileName = `${operationId}.json`
    const validated = await this.readAndValidate(fileName)
    if (validated.payloadHash !== payloadHash) throw new Error('agent_proposal_changed_refresh_preview')

    const existing = this.deps.getOperation(operationId)
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new Error('agent_operation_hash_conflict')
      await this.archiveProposal(fileName, 'processed', operationId, payloadHash, validated.envelope.kind, 0, 0, validated.view.provenance)
      return { duplicate: true, bills: 0, investments: 0 }
    }
    if (validated.baselineHash !== baselineHash) throw new Error('agent_proposal_baseline_changed_refresh_preview')

    let bills = 0
    let investments = 0
    if (validated.envelope.kind === 'expenses') {
      const applied = this.deps.applyExpenses(operationId, payloadHash, validated.view.expenses)
      bills = applied.length
      if (applied.length) this.deps.onExpensesApplied?.(applied)
    } else {
      const result = validateInvestmentBatch(validated.envelope.items)
      if (!result.valid) throw new Error('agent_investment_data_invalid_refresh_preview')
      investments = this.deps.applyInvestments(operationId, payloadHash, result.holdings)
    }

    // Business rows + ledger commit first. If this move is interrupted, listProposals
    // reconciles the durable ledger and archives the file without showing it again.
    await this.archiveProposal(fileName, 'processed', operationId, payloadHash, validated.envelope.kind, bills, investments, validated.view.provenance)
    return { duplicate: false, bills, investments }
  }

  async rejectProposal(fileName: string): Promise<void> {
    const scope = await this.requireScope()
    if (!scope) throw new Error('agent_session_required')
    if (!isSimpleJsonName(fileName)) throw new Error('agent_proposal_filename_invalid')
    const paths = this.accountPaths(this.activeUserId!)
    await this.ensureDirectories(this.activeUserId)
    const source = path.join(paths.inbox, fileName)
    const info = await lstat(source)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('agent_proposal_must_be_regular_file')
    const operationId = fileName.slice(0, -'.json'.length)
    let kind = 'unknown'
    let provenance: AgentProposalProvenance | null = null
    try {
      const validated = await this.readAndValidate(fileName)
      kind = validated.envelope.kind
      provenance = validated.view.provenance
    } catch { /* Invalid proposals can still be rejected without source metadata. */ }
    await this.archiveProposal(fileName, 'rejected', operationId, null, kind, 0, 0, provenance)
  }

  private async readAndValidate(fileName: string): Promise<ValidatedProposal> {
    const scope = await this.requireScope()
    if (!scope) throw new Error('agent_session_required')
    if (!isSimpleJsonName(fileName)) throw new Error('提案文件名无效。')
    const paths = this.accountPaths(this.activeUserId!)
    await this.ensureDirectories(this.activeUserId)
    const filePath = path.join(paths.inbox, fileName)
    const before = await lstat(filePath)
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('提案必须是直属普通文件，不能是目录或链接。')
    if (before.size <= 0 || before.size > MAX_PROPOSAL_BYTES) throw new Error('提案文件为空或超过 1 MiB 限制。')

    const handle = await open(filePath, constants.O_RDONLY)
    let raw: string
    try {
      const opened = await handle.stat()
      const after = await lstat(filePath)
      if (!opened.isFile() || opened.size !== before.size || opened.ino !== after.ino || opened.dev !== after.dev || after.isSymbolicLink()) {
        throw new Error('提案文件在读取期间发生变化，已拒绝读取。')
      }
      if (opened.size > MAX_PROPOSAL_BYTES) throw new Error('提案文件超过 1 MiB 限制。')
      raw = await handle.readFile({ encoding: 'utf8' })
    } finally {
      await handle.close()
    }

    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new Error('提案不是有效 JSON。') }
    const envelopeKeys = ['schema_version', 'operation_id', 'scope_token', 'created_at', 'kind', 'items']
    const provenanceKeys = ['skill_name', 'skill_version', 'source_summary']
    if (!isPlainRecord(value) || !hasOptionalExactKeys(value, envelopeKeys, provenanceKeys)) {
      throw new Error('提案顶层字段不符合白名单。')
    }
    const envelope = value as unknown as ProposalEnvelope
    if (envelope.schema_version !== PROPOSAL_SCHEMA) throw new Error('不支持的提案 schema_version。')
    if (!isUuid(envelope.operation_id) || fileName !== `${envelope.operation_id}.json`) throw new Error('operation_id 与提案文件名不匹配。')
    if (envelope.scope_token !== scope.token) throw new Error('提案属于已过期或其他登录账号的 scope。')
    if (!isValidTimestamp(envelope.created_at)) throw new Error('提案创建时间无效或已超过 30 天。')
    if (!Array.isArray(envelope.items) || envelope.items.length > MAX_PROPOSAL_ITEMS) throw new Error(`提案最多允许 ${MAX_PROPOSAL_ITEMS} 项。`)
    if (envelope.kind !== 'expenses' && envelope.kind !== 'investments') throw new Error('提案 kind 不在支持范围。')
    const provenance = validateProposalProvenance(envelope, envelope.kind)

    const payloadHash = sha256(canonicalStringify(value))
    if (envelope.kind === 'expenses') {
      const expenseValidation = validateExpenses(envelope.items)
      if (!expenseValidation.valid) throw new Error(expenseValidation.errors[0] || '支出条目无效。')
      const categories = this.getValidatedCategories()
      const items = expenseValidation.items
      for (const item of items) {
        const children = categories.get(item.category1)
        if (!children) throw new Error(`支出分类“${item.category1}”已不存在，请刷新后重新生成提案。`)
        if (!children.has(item.category2)) throw new Error(`二级分类已不存在，请刷新后重新生成提案。`)
      }
      const duplicates = this.findDuplicateIndexes(items)
      const baselineHash = sha256(canonicalStringify({ categories: [...categories].map(([name, children]) => [name, [...children].sort()]), duplicates }))
      return {
        envelope,
        payloadHash,
        baselineHash,
        view: {
          fileName, operationId: envelope.operation_id, payloadHash, baselineHash,
          kind: 'expenses', createdAt: envelope.created_at, provenance, expenses: items,
          duplicateIndexes: duplicates, investmentDiff: null, errors: [], alreadyApplied: false
        }
      }
    }

    const holdingsResult = validateInvestmentBatch(envelope.items)
    if (!holdingsResult.valid) throw new Error(holdingsResult.errors[0]?.message || '投资持仓条目无效。')
    const existingHoldings = this.deps.getInvestments()
    const diff = computeInvestmentDiff(existingHoldings, holdingsResult.holdings)
    if (!diff.valid) throw new Error(diff.errors[0]?.message || '当前持仓数据无效。')
    const baselineHash = sha256(canonicalStringify(existingHoldings))
    return {
      envelope,
      payloadHash,
      baselineHash,
      view: {
        fileName, operationId: envelope.operation_id, payloadHash, baselineHash,
        kind: 'investments', createdAt: envelope.created_at, provenance, expenses: [],
        duplicateIndexes: [],
        investmentDiff: { added: diff.added, changed: diff.changed, unchanged: diff.unchanged, unmentioned: diff.unmentioned },
        errors: [], alreadyApplied: false
      }
    }
  }

  private getValidatedCategories(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>()
    for (const category of this.deps.getExpenseCategories()) {
      if (category.type !== 'expense') continue
      let children: unknown
      try { children = JSON.parse(category.children) } catch { continue }
      if (!Array.isArray(children) || children.some((child) => typeof child !== 'string')) continue
      result.set(category.name, new Set(children as string[]))
    }
    return result
  }

  private findDuplicateIndexes(items: AgentExpenseItem[]): number[] {
    const bills = this.deps.getBills()
    const signatures = new Set<string>()
    const duplicates: number[] = []
    for (const bill of bills) signatures.add(expenseSignature(bill))
    items.forEach((item, index) => {
      const signature = expenseSignature(item)
      if (signatures.has(signature)) duplicates.push(index)
      signatures.add(signature)
    })
    return duplicates
  }

  private async requireScope(): Promise<PersistedScope | null> {
    const sessionUserId = this.deps.getSessionUserId()
    const databaseUserId = this.deps.getDatabaseUserId()
    if (!sessionUserId || sessionUserId !== databaseUserId || sessionUserId !== this.activeUserId) return null
    if (!this.activeScope || this.activeScope.expiresAt <= Date.now()) {
      this.activeScope = this.newScope()
      await this.writePersistedScope(sessionUserId, this.activeScope)
    }
    return this.activeScope
  }

  private newScope(): PersistedScope {
    return { token: randomUUID(), expiresAt: Date.now() + SCOPE_TTL_MS }
  }

  private scopeFile(userId: string): string {
    return path.join(this.scopeDir, `${this.accountKey(userId)}.json`)
  }

  private accountKey(userId: string): string {
    return createHash('sha256').update(userId, 'utf8').digest('hex')
  }

  private async readPersistedScope(userId: string): Promise<PersistedScope | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.scopeFile(userId), 'utf8'))
      if (!isPlainRecord(parsed) || typeof parsed.token !== 'string' || !isUuid(parsed.token) || typeof parsed.expiresAt !== 'number') return null
      return { token: parsed.token, expiresAt: parsed.expiresAt }
    } catch { return null }
  }

  private async writePersistedScope(userId: string, scope: PersistedScope): Promise<void> {
    await this.ensureDirectories(userId)
    await this.atomicWrite(this.scopeFile(userId), JSON.stringify(scope))
  }

  private async rotatePersistedScope(userId: string): Promise<void> {
    await this.writePersistedScope(userId, this.newScope())
  }

  private accountPaths(userId: string): { accountRoot: string; contextPath: string; inbox: string; processed: string; rejected: string } {
    const accountKey = this.accountKey(userId)
    const accountRoot = path.join(this.accountsDir, accountKey, 'agent-sync')
    return {
      accountRoot,
      contextPath: path.join(accountRoot, 'context.json'),
      inbox: path.join(accountRoot, 'inbox'),
      processed: path.join(accountRoot, 'processed'),
      rejected: path.join(accountRoot, 'rejected')
    }
  }

  private async ensureDirectories(userId: string | null = this.activeUserId): Promise<void> {
    const dirs = [this.root, this.scopeDir, this.accountsDir]
    if (userId) {
      const paths = this.accountPaths(userId)
      dirs.push(paths.accountRoot, paths.inbox, paths.processed, paths.rejected)
    }
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true })
      const info = await lstat(dir)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('agent_inbox_directory_must_not_be_link')
    }
    const rootReal = await import('node:fs/promises').then(({ realpath }) => realpath(this.root))
    for (const dir of dirs) {
      const real = await import('node:fs/promises').then(({ realpath }) => realpath(dir))
      if (!isWithin(rootReal, real)) throw new Error('agent_inbox_path_escape')
    }
  }

  private scrubbedContext(): string {
    return JSON.stringify({
      schema_version: 'thunder-agent-context/v1',
      expires_at: new Date(0).toISOString(),
      scope_token: '',
      expense_categories: [],
      investment_holdings: [],
      investment_snapshot_history: []
    })
  }

  private async scrubContext(userId: string): Promise<void> {
    const paths = this.accountPaths(userId)
    await this.ensureDirectories(userId)
    await this.atomicWrite(paths.contextPath, this.scrubbedContext())
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const temporary = `${filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, filePath)
  }

  private async archiveProposal(
    fileName: string,
    state: 'processed' | 'rejected',
    operationId: string,
    payloadHash: string | null,
    kind: string,
    bills: number,
    investments: number,
    provenance: AgentProposalProvenance | null = null
  ): Promise<void> {
    if (!this.activeUserId) throw new Error('agent_session_required')
    const paths = this.accountPaths(this.activeUserId)
    const source = path.join(paths.inbox, fileName)
    const sourceInfo = await lstat(source)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('agent_proposal_must_be_regular_file')
    const receipt = {
      schema_version: 'thunder-agent-receipt/v1',
      operation_id: operationId,
      payload_hash: payloadHash,
      kind,
      state,
      processed_at: new Date().toISOString(),
      bills,
      investments,
      ...(provenance ? { provenance } : {})
    }
    const receiptTemp = path.join(paths.inbox, `.${randomUUID()}.receipt.tmp`)
    await writeFile(receiptTemp, JSON.stringify(receipt), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    // Replace the original material before archiving so accepted/rejected folders
    // retain only a small receipt, never the financial rows or source notes.
    await rename(receiptTemp, source)
    const directory = state === 'processed' ? paths.processed : paths.rejected
    const suffix = `${operationId}-${payloadHash?.slice(0, 12) || 'rejected'}-${randomUUID()}.json`
    await rename(source, path.join(directory, suffix))
  }

  private async readReceipt(filePath: string, fileName: string): Promise<{
    operation_id: string; payload_hash: string | null; state: 'processed' | 'rejected'
  } | null> {
    try {
      const info = await lstat(filePath)
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 4096) return null
      const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      if (!isPlainRecord(value) || value.schema_version !== 'thunder-agent-receipt/v1' ||
        !isUuid(value.operation_id) || fileName !== `${value.operation_id}.json` ||
        (value.state !== 'processed' && value.state !== 'rejected') ||
        !(value.payload_hash === null || isSha256(value.payload_hash))) return null
      return { operation_id: value.operation_id, payload_hash: value.payload_hash, state: value.state }
    } catch { return null }
  }

  private invalidPreview(fileName: string, message: string): AgentProposalPreview {
    return {
      fileName, operationId: null, payloadHash: null, baselineHash: null,
      kind: 'invalid', createdAt: null, expenses: [], duplicateIndexes: [],
      provenance: null, investmentDiff: null, errors: [message], alreadyApplied: false
    }
  }
}

function validateExpenses(items: unknown[]): { valid: true; items: AgentExpenseItem[] } | { valid: false; errors: string[] } {
  if (items.length > MAX_PROPOSAL_ITEMS) return { valid: false, errors: ['支出批次超过 200 项。'] }
  const validated: AgentExpenseItem[] = []
  for (let index = 0; index < items.length; index++) {
    const value = items[index]
    if (!isPlainRecord(value) || !hasExactKeys(value, ['amount', 'category1', 'category2', 'date', 'note'])) {
      return { valid: false, errors: [`第 ${index + 1} 项字段不符合支出白名单。`] }
    }
    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0 || value.amount > 1_000_000_000_000) {
      return { valid: false, errors: [`第 ${index + 1} 项金额无效。`] }
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(value.amount.toString())) {
      return { valid: false, errors: [`第 ${index + 1} 项金额最多保留两位小数。`] }
    }
    if (!isBoundedText(value.category1, 1, 120) || !isBoundedText(value.category2, 1, 120) || !isBoundedText(value.note, 0, 1000)) {
      return { valid: false, errors: [`第 ${index + 1} 项分类或备注长度无效。`] }
    }
    if (!isRealDate(value.date)) return { valid: false, errors: [`第 ${index + 1} 项日期无效。`] }
    validated.push({ amount: value.amount, category1: value.category1, category2: value.category2, date: value.date, note: value.note })
  }
  return { valid: true, items: validated }
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= Date.now() + 5 * 60_000 && time >= Date.now() - SCOPE_TTL_MS
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && (min === 0 || value.trim().length > 0)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function hasOptionalExactKeys(value: Record<string, unknown>, required: string[], optionalGroup: string[]): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optionalGroup])
  const optionalCount = optionalGroup.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).length
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    (optionalCount === 0 || optionalCount === optionalGroup.length) &&
    keys.every((key) => allowed.has(key)) && keys.length === required.length + optionalCount
}

function validateProposalProvenance(envelope: ProposalEnvelope, kind: 'expenses' | 'investments'): AgentProposalProvenance | null {
  const present = ['skill_name', 'skill_version', 'source_summary'].filter((key) =>
    Object.prototype.hasOwnProperty.call(envelope, key)
  ).length
  if (present === 0) return null
  if (present !== 3) throw new Error('Skill 来源说明字段必须同时提供。')
  const expectedSkill = kind === 'expenses' ? 'thunder-expense-entry' : 'thunder-investment-snapshot'
  if (envelope.skill_name !== expectedSkill) throw new Error('Skill 名称与提案类型不匹配。')
  if (typeof envelope.skill_version !== 'string' || envelope.skill_version.length > 32 ||
    !/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:-[0-9A-Za-z.-]{1,20})?$/.test(envelope.skill_version)) {
    throw new Error('Skill 版本必须是有界的 semver 字符串。')
  }
  validateSourceSummary(envelope.source_summary)
  return {
    skill_name: envelope.skill_name,
    skill_version: envelope.skill_version,
    source_summary: envelope.source_summary
  }
}

function validateSourceSummary(summary: unknown): asserts summary is string {
  if (typeof summary !== 'string' || summary.trim().length === 0 || summary.length > 500 || summary.trim() !== summary) {
    throw new Error('来源摘要必须是 1–500 字符的简短文本。')
  }
  if (/[\u0000-\u001f\u007f]/.test(summary)) throw new Error('来源摘要不能包含控制字符。')
  const forbidden = [
    /(?:^|\s)[A-Za-z]:[\\/]/,
    /(?:^|\s)\\\\/,
    /\bfile:\/\//i,
    /(?:^|\s)\/(?:Users|home|tmp|private|var|mnt|Volumes)\b/i,
    /\b(?:password|passwd|secret|api[\s_-]?key|bearer|authorization|scope[\s_-]?token)\b/i,
    /\b(?:cloudbase|broker)[\s_-]*(?:key|secret|token|credential)\b/i,
    /(?<!\d)1[3-9]\d{9}(?!\d)/,
    /(?<!\d)\d{16,19}(?!\d)/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  ]
  if (forbidden.some((pattern) => pattern.test(summary))) {
    throw new Error('来源摘要不能包含路径、凭证、手机号、账号号或邮箱。')
  }
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function expenseSignature(item: AgentBill): string {
  return canonicalStringify({ amount: item.amount, category1: item.category1, category2: item.category2, date: item.date, note: item.note })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isSimpleJsonName(value: string): boolean {
  return value.toLowerCase().endsWith('.json') && isUuid(value.slice(0, -'.json'.length))
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isWithin(root: string, child: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}
