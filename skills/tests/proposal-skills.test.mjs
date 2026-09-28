import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expenseHelper = path.join(skillsRoot, 'thunder-expense-entry', 'scripts', 'submit.mjs')
const investmentHelper = path.join(skillsRoot, 'thunder-investment-snapshot', 'scripts', 'submit.mjs')
const expenseRows = [{ amount: 32.5, category1: '餐饮食品', category2: '午餐', date: '2026-09-28', note: 'Synthetic fixture purchase' }]
const holdingRows = [{
  asset_key: 'SYNTHETIC:US:FIXTURE',
  name: 'Synthetic Fund',
  asset_type: 'fund',
  quantity: '1.250000000000000001',
  cost_basis: '10.50',
  market_value: null,
  currency: 'USD',
  as_of: '2026-09-28',
  source_note: 'Synthetic fixture statement, 2026-09-28, page 1',
  quantity_kind: 'shares',
  cost_basis_kind: 'total',
  cash_flows: [{ flow_id: 'fixture-flow-001', date: '2026-09-25', kind: 'contribution', amount: '10.25', currency: 'USD', included_in_market_value: false }],
  cash_flows_complete: true
}]

function setupContext() {
  const root = path.join(mkdtempSync(path.join(os.tmpdir(), 'thunder-skill-fixture-')), 'agent-sync')
  mkdirSync(root)
  const inbox = path.join(root, 'inbox')
  mkdirSync(inbox)
  const contextPath = path.join(root, 'context.json')
  writeFileSync(contextPath, JSON.stringify({
    schema_version: 'thunder-agent-context/v1',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    scope_token: '11111111-1111-4111-8111-111111111111',
    expense_categories: [{ name: '餐饮食品', children: ['午餐'] }],
    investment_holdings: []
  }))
  return { root, inbox, contextPath }
}

function run(helper, contextPath, items, sourceSummary = 'Synthetic statement dated 2026-09-28; one row') {
  return spawnSync(process.execPath, [helper, '--context', contextPath], {
    input: JSON.stringify({ source_summary: sourceSummary, items }), encoding: 'utf8', timeout: 10_000
  })
}

function readOnlyProposal(inbox) {
  const files = readdirSync(inbox).filter((name) => name.endsWith('.json'))
  assert.equal(files.length, 1)
  const proposal = JSON.parse(readFileSync(path.join(inbox, files[0]), 'utf8'))
  return { files, proposal }
}

test('expense Skill emits only a scoped proposal for a valid two-level synthetic bill', () => {
  const fixture = setupContext()
  const result = run(expenseHelper, fixture.contextPath, expenseRows)
  assert.equal(result.status, 0, result.stderr)
  const { files, proposal } = readOnlyProposal(fixture.inbox)
  assert.match(files[0], /^[0-9a-f-]{36}\.json$/i)
  assert.equal(proposal.schema_version, 'thunder-agent-proposal/v1')
  assert.equal(proposal.kind, 'expenses')
  assert.equal(proposal.scope_token, '11111111-1111-4111-8111-111111111111')
  assert.equal(proposal.skill_name, 'thunder-expense-entry')
  assert.equal(proposal.skill_version, '1.0.0')
  assert.equal(proposal.source_summary, 'Synthetic statement dated 2026-09-28; one row')
  assert.deepEqual(proposal.items, expenseRows)
  assert.equal('userId' in proposal, false)
})

test('expense Skill refuses a stale category without writing a proposal', () => {
  const fixture = setupContext()
  const result = run(expenseHelper, fixture.contextPath, [{ ...expenseRows[0], category2: '不存在' }])
  assert.notEqual(result.status, 0)
  assert.deepEqual(readdirSync(fixture.inbox), [])
})

test('expense Skill refuses sub-cent amounts without writing a proposal', () => {
  const fixture = setupContext()
  const result = run(expenseHelper, fixture.contextPath, [{ ...expenseRows[0], amount: 32.555 }])
  assert.notEqual(result.status, 0)
  assert.deepEqual(readdirSync(fixture.inbox), [])
})

test('both Skills refuse source summaries containing paths or personal identifiers', () => {
  for (const helper of [expenseHelper, investmentHelper]) {
    for (const summary of ['Imported from C:\\Users\\Alice\\statement.pdf', 'Statement for 13800138000', 'source_summary\nsecond line']) {
      const fixture = setupContext()
      const result = run(helper, fixture.contextPath, helper === expenseHelper ? expenseRows : holdingRows, summary)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /source_summary/)
      assert.deepEqual(readdirSync(fixture.inbox), [])
    }
  }
})

test('investment Skill reads bounded history above 64 KiB, validates its limits, and never copies it into the proposal', () => {
  const fixture = setupContext()
  const context = JSON.parse(readFileSync(fixture.contextPath, 'utf8'))
  const historyMarker = 'SYNTHETIC_HISTORY_ONLY_'
  context.investment_snapshot_history = Array.from({ length: 80 }, (_, index) => ({
    ...holdingRows[0],
    as_of: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    source_note: `${historyMarker}${String(index).padStart(3, '0')};${'h'.repeat(970)}`,
    cash_flows: [],
    cash_flows_complete: false,
    operation_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    recorded_at: '2026-09-28T12:00:00.000Z'
  }))
  writeFileSync(fixture.contextPath, JSON.stringify(context))
  assert.ok(readFileSync(fixture.contextPath).byteLength > 64 * 1024)
  const result = run(investmentHelper, fixture.contextPath, holdingRows)
  assert.equal(result.status, 0, result.stderr)
  const { proposal } = readOnlyProposal(fixture.inbox)
  assert.deepEqual(proposal.items, holdingRows)
  assert.doesNotMatch(JSON.stringify(proposal), new RegExp(historyMarker))

  const oversized = setupContext()
  const tooMany = JSON.parse(readFileSync(oversized.contextPath, 'utf8'))
  tooMany.investment_snapshot_history = Array.from({ length: 10001 }, () => ({}))
  writeFileSync(oversized.contextPath, JSON.stringify(tooMany))
  const countResult = run(investmentHelper, oversized.contextPath, holdingRows)
  assert.notEqual(countResult.status, 0)
  assert.match(countResult.stderr, /history.*too large/i)
  assert.deepEqual(readdirSync(oversized.inbox), [])

  const invalidField = setupContext()
  const malformed = JSON.parse(readFileSync(invalidField.contextPath, 'utf8'))
  malformed.investment_snapshot_history = [{
    ...holdingRows[0], cash_flows: [], cash_flows_complete: false,
    operation_id: '33333333-3333-4333-8333-000000000001',
    recorded_at: '2026-09-28T12:00:00.000Z', source_note: 'x'.repeat(1001)
  }]
  writeFileSync(invalidField.contextPath, JSON.stringify(malformed))
  const stringResult = run(investmentHelper, invalidField.contextPath, holdingRows)
  assert.notEqual(stringResult.status, 0)
  assert.match(stringResult.stderr, /source_note/)
  assert.deepEqual(readdirSync(invalidField.inbox), [])
})

test('proposal item count and string limits are checked before staging', () => {
  const expenseFixture = setupContext()
  const longNote = run(expenseHelper, expenseFixture.contextPath, [{ ...expenseRows[0], note: 'x'.repeat(1001) }])
  assert.notEqual(longNote.status, 0)
  assert.deepEqual(readdirSync(expenseFixture.inbox), [])

  const investmentFixture = setupContext()
  const longName = run(investmentHelper, investmentFixture.contextPath, [{ ...holdingRows[0], name: 'x'.repeat(121) }])
  assert.notEqual(longName.status, 0)
  assert.deepEqual(readdirSync(investmentFixture.inbox), [])

  const tooMany = run(investmentHelper, investmentFixture.contextPath, Array.from({ length: 201 }, (_, index) => ({
    ...holdingRows[0], asset_key: `SYNTHETIC:US:ROW-${index}`
  })))
  assert.notEqual(tooMany.status, 0)
  assert.match(tooMany.stderr, /1–200/)
  assert.deepEqual(readdirSync(investmentFixture.inbox), [])
})

test('both Skills refuse expired context and non-app context paths', () => {
  for (const helper of [expenseHelper, investmentHelper]) {
    const expired = setupContext()
    const context = JSON.parse(readFileSync(expired.contextPath, 'utf8'))
    context.expires_at = new Date(Date.now() - 60_000).toISOString()
    writeFileSync(expired.contextPath, JSON.stringify(context))
    const expiredRun = run(helper, expired.contextPath, helper === expenseHelper ? expenseRows : holdingRows)
    assert.notEqual(expiredRun.status, 0)
    assert.match(expiredRun.stderr, /expired/)
    assert.deepEqual(readdirSync(expired.inbox), [])

    const wrongPathRun = run(helper, path.join(expired.root, 'not-app-managed', 'context.json'), helper === expenseHelper ? expenseRows : holdingRows)
    assert.notEqual(wrongPathRun.status, 0)
    assert.deepEqual(readdirSync(expired.inbox), [])

    const malformedScope = setupContext()
    const invalidContext = JSON.parse(readFileSync(malformedScope.contextPath, 'utf8'))
    invalidContext.scope_token = 'not-a-session-scope'
    writeFileSync(malformedScope.contextPath, JSON.stringify(invalidContext))
    const scopeRun = run(helper, malformedScope.contextPath, helper === expenseHelper ? expenseRows : holdingRows)
    assert.notEqual(scopeRun.status, 0)
    assert.deepEqual(readdirSync(malformedScope.inbox), [])
  }
})

test('investment Skill preserves decimal strings and produces an explicit snapshot proposal', () => {
  const fixture = setupContext()
  const result = run(investmentHelper, fixture.contextPath, holdingRows)
  assert.equal(result.status, 0, result.stderr)
  const { proposal } = readOnlyProposal(fixture.inbox)
  assert.equal(proposal.kind, 'investments')
  assert.equal(proposal.skill_name, 'thunder-investment-snapshot')
  assert.equal(proposal.skill_version, '1.0.0')
  assert.equal(proposal.source_summary, 'Synthetic statement dated 2026-09-28; one row')
  assert.equal(proposal.items[0].quantity, '1.250000000000000001')
  assert.equal(proposal.items[0].market_value, null)
  assert.equal(proposal.items[0].quantity_kind, 'shares')
  assert.equal(proposal.items[0].cost_basis_kind, 'total')
  assert.equal(proposal.items[0].cash_flows_complete, true)
  assert.deepEqual(proposal.items[0].cash_flows, holdingRows[0].cash_flows)
  assert.equal('userId' in proposal, false)
})

test('investment Skill rejects duplicate stable keys and keeps the inbox unchanged', () => {
  const fixture = setupContext()
  const result = run(investmentHelper, fixture.contextPath, [holdingRows[0], holdingRows[0]])
  assert.notEqual(result.status, 0)
  assert.deepEqual(readdirSync(fixture.inbox), [])
})

test('investment Skill requires explicit quantity, cost, and flow semantics', () => {
  const fixture = setupContext()
  const { quantity_kind, ...legacyRow } = holdingRows[0]
  const result = run(investmentHelper, fixture.contextPath, [legacyRow])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /quantity_kind/)
  assert.deepEqual(readdirSync(fixture.inbox), [])
})

test('investment Skill preserves unknown coverage without converting it to zero flows', () => {
  const fixture = setupContext()
  const unknownRow = {
    ...holdingRows[0],
    cost_basis: null,
    quantity_kind: 'unknown',
    cost_basis_kind: 'unknown',
    cash_flows: [],
    cash_flows_complete: false
  }
  const result = run(investmentHelper, fixture.contextPath, [unknownRow])
  assert.equal(result.status, 0, result.stderr)
  const { proposal } = readOnlyProposal(fixture.inbox)
  assert.equal(proposal.items[0].quantity_kind, 'unknown')
  assert.equal(proposal.items[0].cash_flows_complete, false)
  assert.deepEqual(proposal.items[0].cash_flows, [])
})

test('investment Skill rejects zero or negative cash flow amounts without staging', () => {
  for (const amount of ['0', '-1.00']) {
    const fixture = setupContext()
    const row = { ...holdingRows[0], cash_flows: [{ ...holdingRows[0].cash_flows[0], amount }] }
    const result = run(investmentHelper, fixture.contextPath, [row])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /positive decimal string/)
    assert.deepEqual(readdirSync(fixture.inbox), [])
  }
})

test('shared schemas are valid JSON and describe the v1 scoped envelope', () => {
  const protocolRoot = path.join(skillsRoot, 'protocol')
  const contextSchema = JSON.parse(readFileSync(path.join(protocolRoot, 'thunder-agent-context-v1.schema.json'), 'utf8'))
  const proposalSchema = JSON.parse(readFileSync(path.join(protocolRoot, 'thunder-agent-proposal-v1.schema.json'), 'utf8'))
  assert.equal(contextSchema.properties.schema_version.const, 'thunder-agent-context/v1')
  assert.equal(proposalSchema.properties.schema_version.const, 'thunder-agent-proposal/v1')
  assert.deepEqual(proposalSchema.required, ['schema_version', 'operation_id', 'scope_token', 'created_at', 'kind', 'items'])
  assert.equal(proposalSchema.properties.skill_name.enum.length, 2)
  assert.equal(proposalSchema.properties.source_summary.maxLength, 500)
  assert.equal(proposalSchema.$defs.holding.properties.cash_flows_complete.type, 'boolean')
  assert.equal(proposalSchema.$defs.holding.required.includes('quantity_kind'), false, 'legacy v1 holdings remain schema-compatible')
})

test('published Skills follow the Agent Skills name and description frontmatter limits', () => {
  for (const skillName of ['thunder-expense-entry', 'thunder-investment-snapshot']) {
    const skillPath = path.join(skillsRoot, skillName, 'SKILL.md')
    const source = readFileSync(skillPath, 'utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/m.exec(source)
    assert.ok(match, `${skillName} must start with YAML frontmatter`)
    const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim()
    const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim()
    const version = /^  version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?$/m.exec(match[1])?.[1]
    assert.equal(name, skillName)
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(description && description.length <= 1024)
    assert.equal(version, '1.0.0')
    assert.match(source, /<operation_id>\.json/)
    assert.match(source, /打开提案目录/)
    assert.match(source, /刷新/)
    assert.match(source, /source_summary/)
  }
})

test('proposal helpers have no direct network, process-spawn, database, or confirmation capability', () => {
  for (const helper of [expenseHelper, investmentHelper]) {
    const source = readFileSync(helper, 'utf8')
    assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dgram)|\b(?:fetch|spawn|execFile|database|cloudbase|sqlite)\s*\(/i)
    assert.match(source, /writeFile|\.writeFile/)
    assert.match(source, /nothing has been written|nothing has been written/i)
  }
})
