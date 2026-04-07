import { randomUUID } from 'crypto'

/**
 * Transform a raw Slack event payload into a standard BrokerEvent.
 *
 * @param {object} payload - Parsed Slack Events API body
 * @returns {object} BrokerEvent
 */
export const transformSlackEvent = (payload) => {
  const slackEvent = payload.event || {}
  const threadTs = slackEvent.thread_ts || slackEvent.ts

  return {
    event_id: randomUUID(),
    created_at: new Date().toISOString(),
    source: 'slack',
    source_meta: {
      channel_id: slackEvent.channel,
      thread_ts: threadTs,
      user_id: slackEvent.user,
      raw: payload,
    },
    // Strip @mention tags (e.g. <@U1234567>) from message text
    text: (slackEvent.text || '').replace(/<@[A-Z0-9]+>/g, '').trim(),
    reply_to: {
      channel: `slack://${slackEvent.channel}`,
      thread_ts: threadTs,
    },
    requested_by: `slack://${slackEvent.user}`,
    tags: [],
    priority: 'normal',
    ttl: 3600,
  }
}
