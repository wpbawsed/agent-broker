import { describe, it, expect } from '@jest/globals'
import { parseReplyChannel } from '../src/reply.js'

describe('parseReplyChannel', () => {
  it('parses slack:// URI', () => {
    const { protocol, target } = parseReplyChannel('slack://C1234567')
    expect(protocol).toBe('slack')
    expect(target).toBe('C1234567')
  })

  it('parses jira:// URI', () => {
    const { protocol, target } = parseReplyChannel('jira://PROJ-123')
    expect(protocol).toBe('jira')
    expect(target).toBe('PROJ-123')
  })

  it('parses webhook:// URI with full URL', () => {
    const { protocol, target } = parseReplyChannel('webhook://https://example.com/callback')
    expect(protocol).toBe('webhook')
    expect(target).toBe('https://example.com/callback')
  })

  it('throws on invalid format', () => {
    expect(() => parseReplyChannel('invalid-channel')).toThrow('Invalid reply_to.channel format')
  })
})
