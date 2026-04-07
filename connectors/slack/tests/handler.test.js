import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mockClient } from 'aws-sdk-client-mock'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import crypto from 'crypto'

const snsMock = mockClient(SNSClient)

const buildSignature = (secret, timestamp, body) => {
  const hmac = crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  return `v0=${hmac}`
}

describe('Slack connector handler', () => {
  const SIGNING_SECRET = 'test-secret'
  const now = Math.floor(Date.now() / 1000)

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-northeast-1:123456789012:test'
    process.env.AWS_REGION = 'ap-northeast-1'
    snsMock.reset()
    snsMock.on(PublishCommand).resolves({ MessageId: 'msg-123' })
  })

  afterEach(() => {
    delete process.env.SLACK_SIGNING_SECRET
    delete process.env.SNS_TOPIC_ARN
    delete process.env.AWS_REGION
  })

  const makeEvent = (body) => {
    const rawBody = JSON.stringify(body)
    const sig = buildSignature(SIGNING_SECRET, now, rawBody)
    return {
      headers: {
        'x-slack-request-timestamp': String(now),
        'x-slack-signature': sig,
      },
      body: rawBody,
    }
  }

  it('responds to url_verification challenge', async () => {
    const { handler } = await import('../src/index.js')
    const res = await handler({
      headers: {},
      body: JSON.stringify({ type: 'url_verification', challenge: 'abc123' }),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).challenge).toBe('abc123')
  })

  it('returns 401 for invalid signature', async () => {
    const { handler } = await import('../src/index.js')
    const res = await handler({
      headers: {
        'x-slack-request-timestamp': String(now),
        'x-slack-signature': 'v0=badsig',
      },
      body: JSON.stringify({ type: 'event_callback' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('ignores bot messages and returns 200', async () => {
    const { handler } = await import('../src/index.js')
    const body = {
      type: 'event_callback',
      event: { bot_id: 'B123', text: 'hello', channel: 'C1', user: 'U1' },
    }
    const res = await handler(makeEvent(body))
    expect(res.statusCode).toBe(200)
    expect(snsMock.calls()).toHaveLength(0)
  })

  it('publishes valid event to SNS', async () => {
    const { handler } = await import('../src/index.js')
    const body = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        user: 'U9876543',
        text: '<@UBOT> hello agent',
        ts: '1234567890.000000',
        channel: 'C1234567',
      },
    }
    const res = await handler(makeEvent(body))
    expect(res.statusCode).toBe(200)
    expect(snsMock.calls()).toHaveLength(1)
    const call = snsMock.calls()[0]
    const published = JSON.parse(call.args[0].input.Message)
    expect(published.source).toBe('slack')
    expect(published.text).toBe('hello agent')
  })
})
