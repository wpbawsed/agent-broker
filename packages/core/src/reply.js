/**
 * reply.js — reply_to URI parsing and dispatch
 *
 * Supported reply_to.channel formats:
 *   slack://C1234567            → Slack chat.postMessage
 *   jira://PROJ-123             → Jira REST comment
 *   webhook://https://...       → HTTP POST
 */

/**
 * Parse a reply_to.channel URI into { protocol, target }.
 */
export const parseReplyChannel = (channel) => {
  const match = channel.match(/^([a-z]+):\/\/(.+)$/)
  if (!match) throw new Error(`Invalid reply_to.channel format: ${channel}`)
  return { protocol: match[1], target: match[2] }
}

/**
 * Dispatch a reply to the channel specified in reply_to.
 *
 * @param {object} replyTo  - BrokerEvent.reply_to
 * @param {string} text     - Reply text
 * @param {object} [opts]   - Optional: { slackToken, jiraBaseUrl, jiraToken }
 */
export const dispatchReply = async (replyTo, text, opts = {}) => {
  const { protocol, target } = parseReplyChannel(replyTo.channel)

  switch (protocol) {
    case 'slack':
      return dispatchSlack(target, replyTo.thread_ts, text, opts)
    case 'jira':
      return dispatchJira(target, text, opts)
    case 'webhook':
      return dispatchWebhook(target, text, replyTo.metadata)
    default:
      throw new Error(`Unsupported reply protocol: ${protocol}`)
  }
}

const dispatchSlack = async (channelId, threadTs, text, opts) => {
  const token = opts.slackToken || process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error('SLACK_BOT_TOKEN is required for Slack replies')

  const body = {
    channel: channelId,
    text,
    ...(threadTs && { thread_ts: threadTs }),
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`)
  return data
}

const dispatchJira = async (issueKey, text, opts) => {
  const baseUrl = opts.jiraBaseUrl || process.env.JIRA_BASE_URL
  const token = opts.jiraToken || process.env.JIRA_API_TOKEN
  if (!baseUrl || !token)
    throw new Error('JIRA_BASE_URL and JIRA_API_TOKEN are required for Jira replies')

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Jira API error ${res.status}: ${err}`)
  }
  return res.json()
}

const dispatchWebhook = async (url, text, metadata) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, metadata }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Webhook error ${res.status}: ${err}`)
  }
  return { ok: true, status: res.status }
}

/**
 * Add or remove a Slack reaction on the original message.
 * Used by agents to show ⏳ processing state and remove it when done.
 *
 * @param {'add'|'remove'} action
 * @param {string} channelId  - Slack channel ID (e.g. from source_meta.channel_id)
 * @param {string} messageTs  - Original message ts (e.g. from source_meta.thread_ts)
 * @param {string} [emoji]    - Emoji name without colons, default: 'hourglass_flowing_sand'
 * @param {object} [opts]     - { slackToken }
 */
export const setSlackReaction = async (
  action,
  channelId,
  messageTs,
  emoji = 'hourglass_flowing_sand',
  opts = {},
) => {
  const token = opts.slackToken || process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error('SLACK_BOT_TOKEN is required for Slack reactions')

  const res = await fetch(`https://slack.com/api/reactions.${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, timestamp: messageTs, name: emoji }),
  })
  const data = await res.json()
  // already_reacted / no_reaction are non-fatal (idempotent)
  if (!data.ok && data.error !== 'already_reacted' && data.error !== 'no_reaction') {
    throw new Error(`Slack reactions.${action} error: ${data.error}`)
  }
  return data
}
