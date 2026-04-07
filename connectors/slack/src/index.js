import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { verifySlackSignature } from './verify.js'
import { transformSlackEvent } from './transform.js'

const sns = new SNSClient({ region: process.env.AWS_REGION || 'ap-northeast-1' })

const respond = (statusCode, body = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/**
 * Add a reaction to the triggering message — fire-and-forget.
 * Gives immediate visual feedback that the bot received the request.
 */
const addProcessingReaction = (channelId, messageTs) => {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token || !channelId || !messageTs) return
  fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageTs,
      name: 'hourglass_flowing_sand',
    }),
  }).catch(() => {}) // intentionally silent — this is best-effort UX
}

export const handler = async (event) => {
  const body = JSON.parse(event.body || '{}')
  console.log(`[slack-connector] event type: ${body?.type}, event subtype: ${body?.event?.type}`)

  // Step 1: Slack URL verification (initial setup handshake)
  if (body.type === 'url_verification') {
    console.log('[slack-connector] url_verification → returning challenge')
    return respond(200, { challenge: body.challenge })
  }

  // Step 2: Verify Slack Signing Secret — respond 401 if invalid
  if (!verifySlackSignature(event)) {
    console.warn('[slack-connector] ❌ invalid signature → 401')
    return respond(401)
  }
  console.log('[slack-connector] ✅ signature verified')

  // Step 3: Filter bot messages to prevent loops
  if (body.event?.bot_id) {
    console.log('[slack-connector] skipping bot message')
    return respond(200)
  }

  // Step 4: Require a text payload to be present
  if (!body.event?.text) {
    console.log('[slack-connector] skipping: no text')
    return respond(200)
  }

  // Step 5: Add ⏳ reaction immediately (fire-and-forget, within Slack's 3s window)
  console.log(
    `[slack-connector] adding ⏳ reaction to channel=${body.event.channel} ts=${body.event.ts}`,
  )
  addProcessingReaction(body.event?.channel, body.event?.ts)

  // Step 6: Transform to standard BrokerEvent and publish to SNS
  const brokerEvent = transformSlackEvent(body)
  console.log(
    `[slack-connector] publishing to SNS: event_id=${brokerEvent.event_id} text="${brokerEvent.text}"`,
  )

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Message: JSON.stringify(brokerEvent),
      MessageAttributes: {
        source: {
          DataType: 'String',
          StringValue: 'slack',
        },
      },
    }),
  )

  console.log('[slack-connector] ✅ SNS published, returning 200')
  return respond(200)
}
