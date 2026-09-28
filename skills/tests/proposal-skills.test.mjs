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
const holdingRows = [{ asset_key: 'BROKER-A:US:FIXTURE', name: 'Synthetic Fund', asset_type: 'fund', quantity: '1.250000000000000001', cost_basis: '10.50', market_value: null, currency: 'USD', as_of: '2026-09-28', source_note: 'Synthetic fixture statement' }]

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

function run(helper, contextPath, items) {
  return spawnSync(process.execPath, [helper, '--context', contextPath], {
    input: JSON.stringify(items), encoding: 'utf8', timeout: 10_000
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

test('investment Skill preserves decimal strings and produces an explicit snapshot proposal', () => {
  const fixture = setupContext()
  const result = run(investmentHelper, fixture.contextPath, holdingRows)
  assert.equal(result.status, 0, result.stderr)
  const { proposal } = readOnlyProposal(fixture.inbox)
  assert.equal(proposal.kind, 'investments')
  assert.equal(proposal.items[0].quantity, '1.250000000000000001')
  assert.equal(proposal.items[0].market_value, null)
  assert.equal('userId' in proposal, false)
})

test('investment Skill rejects duplicate stable keys and keeps the inbox unchanged', () => {
  const fixture = setupContext()
  const result = run(investmentHelper, fixture.contextPath, [holdingRows[0], holdingRows[0]])
  assert.notEqual(result.status, 0)
  assert.deepEqual(readdirSync(fixture.inbox), [])
})
