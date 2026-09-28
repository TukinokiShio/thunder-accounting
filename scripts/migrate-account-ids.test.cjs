const test = require('node:test')
const assert = require('node:assert/strict')
const { getMigrationOptions, generateStandardAccountId } = require('./migrate-account-ids.cjs')

test('account migration requires an explicit single target and defaults to read-only', () => {
  assert.deepEqual(getMigrationOptions(['--account-id', 'TB123456']), { dryRun: true, targetAccountId: 'TB123456' })
  assert.deepEqual(getMigrationOptions(['--dry-run', '--account-id', 'TB123456']), { dryRun: true, targetAccountId: 'TB123456' })
  assert.throws(() => getMigrationOptions([]), /必须通过 --account-id/)
  assert.throws(() => getMigrationOptions(['--account-id', 'TB123456', '--account-id', 'TB123456']), /必须恰好指定一次/)
})

test('writes require the explicit --apply flag', () => {
  assert.deepEqual(getMigrationOptions(['--apply', '--account-id', 'TB123456']), { dryRun: false, targetAccountId: 'TB123456' })
})

test('rejects contradictory migration modes', () => {
  assert.throws(() => getMigrationOptions(['--dry-run', '--apply', '--account-id', 'TB123456']), /不可同时使用/)
})

test('account identifiers are derived from the supplied email digits', () => {
  assert.equal(generateStandardAccountId('sample123456789@example.test'), 'TB123456')
})

test('does not invent a random account identifier when the source identity is insufficient', () => {
  assert.equal(generateStandardAccountId('a@example.test'), null)
})
