import { describe, it, expect } from '@jest/globals'
import { transformSlackEvent } from '../src/transform.js'

const payload = {
  type: 'event_callback',
  team_id: 'T111',
  event: {
    type: 'app_mention',
    user: 'U9876543',
    text: '<@U0LAN0Z89> k8s service status',
    ts: '1234567890.123456',
    channel: 'C1234567',
  },
}

describe('transformSlackEvent', () => {
  it('strips @mention from text', () => {
    const event = transformSlackEvent(payload)
    expect(event.text).toBe('k8s service status')
  })

  it('sets source to slack', () => {
    const event = transformSlackEvent(payload)
    expect(event.source).toBe('slack')
  })

  it('maps channel and user correctly', () => {
    const event = transformSlackEvent(payload)
    expect(event.source_meta.channel_id).toBe('C1234567')
    expect(event.source_meta.user_id).toBe('U9876543')
  })

  it('sets reply_to.channel as slack:// URI', () => {
    const event = transformSlackEvent(payload)
    expect(event.reply_to.channel).toBe('slack://C1234567')
  })

  it('sets thread_ts from event.ts when no thread_ts', () => {
    const event = transformSlackEvent(payload)
    expect(event.reply_to.thread_ts).toBe('1234567890.123456')
  })

  it('generates a valid UUID for event_id', () => {
    const event = transformSlackEvent(payload)
    expect(event.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })
})
