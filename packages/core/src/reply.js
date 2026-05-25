/**
 * reply.js — reply_to URI parsing and dispatch
 *
 * Supported reply_to.channel formats:
 *   slack://C1234567                      → Slack chat.postMessage
 *   jira://PROJ-123                       → Jira REST comment
 *   notion://{pageId}                     → Notion page property update
 *   line://{userId}                       → LINE push message
 *   github://{owner}/{repo}/{number}      → GitHub issue / PR comment
 *   railway://{projectId}/{serviceId}     → Railway (log only, no reply)
 *   webhook://https://...                 → HTTP POST
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
 * @param {object} [opts]   - Optional: { slackToken, jiraBaseUrl, jiraToken, notionToken, githubToken, lineToken }
 */
export const dispatchReply = async (replyTo, text, opts = {}) => {
  const { protocol, target } = parseReplyChannel(replyTo.channel)

  switch (protocol) {
    case 'slack':
      return dispatchSlack(target, replyTo.thread_ts, text, opts)
    case 'jira':
      return dispatchJira(target, text, opts)
    case 'notion':
      return dispatchNotion(target, text, opts)
    case 'line':
      return dispatchLine(target, text, replyTo.metadata, opts)
    case 'github':
      return dispatchGitHub(target, text, opts)
    case 'railway':
      return dispatchRailway(target, text, replyTo.metadata)
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
 * Send a LINE push message to a user / group / room.
 * target = userId / groupId / roomId (from line://{target})
 * metadata.replyToken — if present, use Reply API (must be used within 30s of event);
 *                       otherwise fall back to Push API.
 */
const dispatchLine = async (target, text, metadata, opts) => {
  const token = opts.lineToken || process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required for LINE replies')

  const replyToken = metadata?.replyToken
  const messages = [{ type: 'text', text: text.slice(0, 5000) }]

  let url, body
  if (replyToken) {
    url = 'https://api.line.me/v2/bot/message/reply'
    body = { replyToken, messages }
  } else {
    url = 'https://api.line.me/v2/bot/message/push'
    body = { to: target, messages }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API error ${res.status}: ${err}`)
  }
  return { ok: true }
}

/**
 * Post a comment on a GitHub issue or pull request.
 * target format: {owner}/{repo}/{number}
 * e.g. github://octocat/Hello-World/1
 */
const dispatchGitHub = async (target, text, opts) => {
  const token = opts.githubToken || process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub replies')

  const parts = target.split('/')
  if (parts.length < 3) throw new Error(`Invalid GitHub target: ${target} (expected owner/repo/number)`)
  const [owner, repo, number] = parts

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body: text }),
    },
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${err}`)
  }
  return res.json()
}

/**
 * Railway webhook reply — Railway is typically one-way (deployment events).
 * Logs the reply text; no API call needed unless metadata contains a callback URL.
 */
const dispatchRailway = async (target, text, metadata) => {
  if (metadata?.callbackUrl) {
    return dispatchWebhook(metadata.callbackUrl, text, metadata)
  }
  // Railway events are informational; just log
  console.log(`[railway-reply] ${target}: ${text}`)
  return { ok: true, logged: true }
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

/**
 * Update one or more properties on a Notion page.
 * Mirrors setSlackReaction() — used by agents to reflect processing state back
 * to the originating Notion page (e.g. Status, Assignee, Result).
 *
 * @param {string} pageId     - Notion page ID from source_meta.raw.page_id
 * @param {object} properties - Notion property patch object (Notion API format)
 * @param {object} [opts]     - { notionToken }
 *
 * @example
 * // Mark a page as "In Progress"
 * await updateNotionPage(event.source_meta.raw.page_id, {
 *   Status: { select: { name: 'In Progress' } },
 * }, { notionToken: process.env.NOTION_TOKEN })
 *
 * // Write result back as a rich-text property
 * await updateNotionPage(pageId, {
 *   Result: { rich_text: [{ text: { content: replyText } }] },
 * })
 */
export const updateNotionPage = async (pageId, properties, opts = {}) => {
  const token = opts.notionToken || process.env.NOTION_TOKEN
  if (!token) throw new Error('NOTION_TOKEN is required for Notion page updates')

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({ properties }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion API error ${res.status}: ${err}`)
  }
  return res.json()
}

/**
 * Fetch a Notion page's properties and metadata.
 * Use this to retrieve the full page content after receiving a webhook event —
 * the event itself only contains the page ID, not the actual content.
 *
 * @param {string} pageId   - Notion page ID
 * @param {object} [opts]   - { notionToken }
 * @returns {Promise<object|null>} Notion page object, or null if not found / no access
 *
 * @example
 * const page = await fetchNotionPage(event.payload.entity.id, { notionToken: process.env.NOTION_TOKEN })
 * const title = page?.properties?.title?.title?.[0]?.plain_text ?? '(untitled)'
 */
export const fetchNotionPage = async (pageId, opts = {}) => {
  const token = opts.notionToken || process.env.NOTION_TOKEN
  if (!token) throw new Error('NOTION_TOKEN is required for Notion page fetch')

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  })

  if (!res.ok) return null
  return res.json()
}

/**
 * Fetch a Notion page's block children (the actual body/content).
 * Page properties are metadata; the written content lives in blocks.
 * Flattens all blocks into a plain-text string for easy LLM consumption.
 *
 * @param {string} pageId   - Notion page ID (same as block ID)
 * @param {object} [opts]   - { notionToken, asText: boolean (default true) }
 * @returns {Promise<string|object[]|null>}
 *   - If asText=true (default): plain-text representation of all blocks
 *   - If asText=false: raw blocks array from Notion API
 *   - null if fetch failed
 *
 * @example
 * const content = await fetchNotionBlocks(pageId, { notionToken: process.env.NOTION_TOKEN })
 * // => "# 標題\n\n這裡是內文...\n- 清單項目"
 */
export const fetchNotionBlocks = async (pageId, opts = {}) => {
  const token = opts.notionToken || process.env.NOTION_TOKEN
  if (!token) throw new Error('NOTION_TOKEN is required for Notion blocks fetch')

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  })

  if (!res.ok) return null
  const data = await res.json()
  const blocks = data.results ?? []

  if (opts.asText === false) return blocks

  // Convert blocks to plain text
  return blocks
    .map((block) => {
      const type = block.type
      const richText = block[type]?.rich_text ?? []
      const text = richText.map((t) => t.plain_text).join('')

      switch (type) {
        case 'heading_1':
          return `# ${text}`
        case 'heading_2':
          return `## ${text}`
        case 'heading_3':
          return `### ${text}`
        case 'bulleted_list_item':
          return `- ${text}`
        case 'numbered_list_item':
          return `1. ${text}`
        case 'to_do':
          return `[${block.to_do?.checked ? 'x' : ' '}] ${text}`
        case 'code':
          return `\`\`\`\n${text}\n\`\`\``
        case 'quote':
          return `> ${text}`
        case 'divider':
          return '---'
        case 'paragraph':
          return text
        default:
          return text
      }
    })
    .filter(Boolean)
    .join('\n\n')
}
