import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { verifyJiraWebhook } from '../src/verify.js'

describe('verifyJiraWebhook', () => {
  beforeEach(() => {
    process.env.JIRA_WEBHOOK_SECRET = 'super-secret-token'
  })

  afterEach(() => {
    delete process.env.JIRA_WEBHOOK_SECRET
  })

  it('accepts token via query string', () => {
    const event = { queryStringParameters: { token: 'super-secret-token' }, headers: {} }
    expect(verifyJiraWebhook(event)).toBe(true)
  })

  it('accepts token via header', () => {
    const event = {
      queryStringParameters: {},
      headers: { 'x-jira-webhook-token': 'super-secret-token' },
    }
    expect(verifyJiraWebhook(event)).toBe(true)
  })

  it('rejects wrong token', () => {
    const event = { queryStringParameters: { token: 'wrong' }, headers: {} }
    expect(verifyJiraWebhook(event)).toBe(false)
  })

  it('rejects missing token', () => {
    const event = { queryStringParameters: {}, headers: {} }
    expect(verifyJiraWebhook(event)).toBe(false)
  })
})
