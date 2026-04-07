import { randomUUID } from 'crypto'

const mapJiraPriority = (jiraPriority) => {
  const map = {
    Highest: 'high',
    High: 'high',
    Medium: 'normal',
    Low: 'low',
    Lowest: 'low',
  }
  return map[jiraPriority] ?? 'normal'
}

/**
 * Transform a raw Jira Webhook payload into a standard BrokerEvent.
 *
 * @param {object} payload - Parsed Jira Webhook body
 * @returns {object} BrokerEvent
 */
export const transformJiraEvent = (payload) => {
  const issue = payload.issue || {}
  const fields = issue.fields || {}

  const summary = fields.summary || ''
  const description = fields.description || ''
  const text = [summary, description].filter(Boolean).join('\n').trim()

  return {
    event_id: randomUUID(),
    created_at: new Date().toISOString(),
    source: 'jira',
    source_meta: {
      issue_key: issue.key,
      issue_type: fields.issuetype?.name,
      project_key: fields.project?.key,
      raw: payload,
    },
    text: text || '(no description)',
    reply_to: {
      channel: `jira://${issue.key}`,
    },
    requested_by: `jira://${payload.user?.emailAddress || payload.user?.name || 'unknown'}`,
    tags: Array.isArray(fields.labels) ? fields.labels : [],
    priority: mapJiraPriority(fields.priority?.name),
    ttl: 7200,
  }
}
