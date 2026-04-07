import { describe, it, expect } from '@jest/globals'
import { transformJiraEvent } from '../src/transform.js'

const payload = {
  webhookEvent: 'jira:issue_created',
  user: { emailAddress: 'pm@example.com' },
  issue: {
    key: 'PROJ-42',
    fields: {
      summary: '[Agent] Deploy v2.1.0 to production',
      description: 'Please run helm upgrade for payment-api.',
      issuetype: { name: 'Task' },
      project: { key: 'PROJ' },
      priority: { name: 'High' },
      labels: ['agent-task', 'production'],
    },
  },
}

describe('transformJiraEvent', () => {
  it('sets source to jira', () => {
    expect(transformJiraEvent(payload).source).toBe('jira')
  })

  it('maps issue key and project key', () => {
    const event = transformJiraEvent(payload)
    expect(event.source_meta.issue_key).toBe('PROJ-42')
    expect(event.source_meta.project_key).toBe('PROJ')
  })

  it('concatenates summary and description as text', () => {
    const event = transformJiraEvent(payload)
    expect(event.text).toContain('[Agent] Deploy v2.1.0 to production')
    expect(event.text).toContain('helm upgrade')
  })

  it('sets reply_to.channel as jira:// URI', () => {
    expect(transformJiraEvent(payload).reply_to.channel).toBe('jira://PROJ-42')
  })

  it('maps Jira High priority to high', () => {
    expect(transformJiraEvent(payload).priority).toBe('high')
  })

  it('maps labels to tags', () => {
    expect(transformJiraEvent(payload).tags).toEqual(['agent-task', 'production'])
  })

  it('uses ttl of 7200', () => {
    expect(transformJiraEvent(payload).ttl).toBe(7200)
  })
})
