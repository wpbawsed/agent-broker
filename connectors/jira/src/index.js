import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { verifyJiraWebhook } from './verify.js'
import { transformJiraEvent } from './transform.js'

const sns = new SNSClient({ region: process.env.AWS_REGION || 'ap-northeast-1' })

const respond = (statusCode, body = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  // Verify Jira Webhook secret
  if (!verifyJiraWebhook(event)) {
    console.warn('Jira connector: invalid webhook token')
    return respond(401)
  }

  const body = JSON.parse(event.body || '{}')

  // Only process issue-related events
  if (!body.issue) {
    return respond(200)
  }

  const brokerEvent = transformJiraEvent(body)

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Message: JSON.stringify(brokerEvent),
      MessageAttributes: {
        source: {
          DataType: 'String',
          StringValue: 'jira',
        },
      },
    }),
  )

  return respond(200)
}
