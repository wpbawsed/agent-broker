import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import crypto from 'crypto'
import { verifySlackSignature } from '../src/verify.js'

const SIGNING_SECRET = 'test-secret-1234'

const makeEvent = ({ timestamp, body, signature }) => ({
  headers: {
    'x-slack-request-timestamp': String(timestamp),
    'x-slack-signature': signature,
  },
  body,
})

const buildSignature = (secret, timestamp, body) => {
  const hmac = crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  return `v0=${hmac}`
}

describe('verifySlackSignature', () => {
  const now = Math.floor(Date.now() / 1000)
  const body = '{"type":"event_callback"}'

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET
  })

  afterEach(() => {
    delete process.env.SLACK_SIGNING_SECRET
  })

  it('returns true for a valid signature', () => {
    const sig = buildSignature(SIGNING_SECRET, now, body)
    const event = makeEvent({ timestamp: now, body, signature: sig })
    expect(verifySlackSignature(event)).toBe(true)
  })

  it('returns false when signature is wrong', () => {
    const event = makeEvent({ timestamp: now, body, signature: 'v0=badsig' })
    expect(verifySlackSignature(event)).toBe(false)
  })

  it('returns false when timestamp is older than 5 minutes', () => {
    const oldTs = now - 400
    const sig = buildSignature(SIGNING_SECRET, oldTs, body)
    const event = makeEvent({ timestamp: oldTs, body, signature: sig })
    expect(verifySlackSignature(event)).toBe(false)
  })

  it('returns false when headers are missing', () => {
    expect(verifySlackSignature({ headers: {}, body })).toBe(false)
  })
})
