import { describe, expect, it } from 'vitest'
import { investmentDocumentId } from './investment-cloud-key'

describe('investment CloudBase key', () => {
  it('is stable for the same user and asset across device-local databases', () => {
    expect(investmentDocumentId('fixture-user', 'BROKER-A:US:ACME'))
      .toBe(investmentDocumentId('fixture-user', 'BROKER-A:US:ACME'))
  })

  it('isolates accounts and distinct assets even when local SQLite ids collide', () => {
    const first = investmentDocumentId('fixture-user-a', 'BROKER-A:US:ACME')
    expect(first).not.toBe(investmentDocumentId('fixture-user-b', 'BROKER-A:US:ACME'))
    expect(first).not.toBe(investmentDocumentId('fixture-user-a', 'BROKER-A:US:OTHER'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})
