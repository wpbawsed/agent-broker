import { describe, it, expect } from '@jest/globals'
import { validateEvent, createEvent, BrokerEventSchema } from '../src/schema.js'

const validEvent = {
  event_id: '550e8400-e29b-41d4-a716-446655440000',
  created_at: '2026-03-31T10:00:00.000Z',
  source: 'slack',
  source_meta: {
    channel_id: 'C1234567',
    thread_ts: '1234567890.123456',
    user_id: 'U9876543',
  },
  text: 'Hello agent',
  reply_to: {
    channel: 'slack://C1234567',
    thread_ts: '1234567890.123456',
  },
  requested_by: 'slack://U9876543',
  tags: ['k8s'],
  priority: 'normal',
  ttl: 3600,
}

describe('BrokerEventSchema', () => {
  it('accepts a valid event', () => {
    const result = validateEvent(validEvent)
    expect(result.success).toBe(true)
  })

  it('rejects missing text', () => {
    const result = validateEvent({ ...validEvent, text: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source', () => {
    const result = validateEvent({ ...validEvent, source: 'twitter' })
    expect(result.success).toBe(false)
  })

  it('rejects non-uuid event_id', () => {
    const result = validateEvent({ ...validEvent, event_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid priority', () => {
    const result = validateEvent({ ...validEvent, priority: 'urgent' })
    expect(result.success).toBe(false)
  })

  it('applies default priority=normal when omitted', () => {
    const { priority: _p, ...withoutPriority } = validEvent
    const result = validateEvent(withoutPriority)
    expect(result.success).toBe(true)
    expect(result.data.priority).toBe('normal')
  })

  it('applies default ttl=3600 when omitted', () => {
    const { ttl: _t, ...withoutTtl } = validEvent
    const result = validateEvent(withoutTtl)
    expect(result.success).toBe(true)
    expect(result.data.ttl).toBe(3600)
  })
})

describe('createEvent', () => {
  it('generates event_id and created_at automatically', () => {
    const event = createEvent({
      source: 'slack',
      source_meta: { channel_id: 'C111' },
      text: 'test message',
      reply_to: { channel: 'slack://C111' },
      requested_by: 'slack://U111',
    })
    expect(event.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(event.created_at).toBeTruthy()
  })

  it('throws on invalid fields', () => {
    expect(() =>
      createEvent({
        source: 'invalid-source',
        source_meta: {},
        text: 'hi',
        reply_to: { channel: 'slack://C1' },
        requested_by: 'slack://U1',
      }),
    ).toThrow()
  })
})
