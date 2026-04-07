import { describe, it, expect, beforeEach } from '@jest/globals'
import { mockClient } from 'aws-sdk-client-mock'
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs'
import { AgentConsumer } from '../src/consumer.js'

const sqsMock = mockClient(SQSClient)

const brokerEvent = {
  event_id: '550e8400-e29b-41d4-a716-446655440000',
  created_at: '2026-03-31T10:00:00.000Z',
  source: 'slack',
  source_meta: { channel_id: 'C1' },
  text: 'hello agent',
  reply_to: { channel: 'slack://C1', thread_ts: '111.222' },
  requested_by: 'slack://U1',
  priority: 'normal',
  ttl: 3600,
}

// SNS wraps the BrokerEvent inside { Message: "..." }
const sqsMessage = {
  MessageId: 'sqs-msg-1',
  ReceiptHandle: 'receipt-handle-abc',
  Body: JSON.stringify({ Message: JSON.stringify(brokerEvent) }),
}

describe('AgentConsumer', () => {
  beforeEach(() => {
    sqsMock.reset()
    process.env.AWS_REGION = 'ap-northeast-1'
  })

  it('throws if queueUrl is missing', () => {
    expect(() => new AgentConsumer({ agentId: 'test-agent' })).toThrow('queueUrl is required')
  })

  it('throws if agentId is missing', () => {
    expect(() => new AgentConsumer({ queueUrl: 'https://sqs.example.com/q' })).toThrow(
      'agentId is required',
    )
  })

  it('exposes agentId', () => {
    const agent = new AgentConsumer({
      queueUrl: 'https://sqs.example.com/q',
      agentId: 'my-agent',
    })
    expect(agent.agentId).toBe('my-agent')
  })
})

describe('AgentConsumer ctx', () => {
  beforeEach(() => sqsMock.reset())

  it('ctx.done() calls DeleteMessage', async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [sqsMessage] })
      .resolves({ Messages: [] })
    sqsMock.on(DeleteMessageCommand).resolves({})

    const agent = new AgentConsumer({
      queueUrl: 'https://sqs.example.com/q',
      agentId: 'test-agent',
      healthPort: 0,
    })

    // Separate the "message handled" signal from agent teardown so that
    // agent.stop() is awaited by the test (not inside an unawaited handler).
    const messageHandled = new Promise((resolve, reject) => {
      agent.on('message', async (event, ctx) => {
        try {
          await ctx.done()
          resolve()
        } catch (e) {
          reject(e)
        }
      })
      agent.on('error', reject)
      agent.start()
    })

    await messageHandled
    await agent.stop()

    const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand)
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].args[0].input.ReceiptHandle).toBe('receipt-handle-abc')
  })

  it('ctx.extend() calls ChangeMessageVisibility', async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [sqsMessage] })
      .resolves({ Messages: [] })
    sqsMock.on(ChangeMessageVisibilityCommand).resolves({})
    sqsMock.on(DeleteMessageCommand).resolves({})

    const agent = new AgentConsumer({
      queueUrl: 'https://sqs.example.com/q',
      agentId: 'test-agent',
      healthPort: 0,
    })

    const messageHandled = new Promise((resolve, reject) => {
      agent.on('message', async (_event, ctx) => {
        try {
          await ctx.extend(120)
          await ctx.done()
          resolve()
        } catch (e) {
          reject(e)
        }
      })
      agent.on('error', reject)
      agent.start()
    })

    await messageHandled
    await agent.stop()

    const extendCalls = sqsMock.commandCalls(ChangeMessageVisibilityCommand)
    expect(extendCalls).toHaveLength(1)
    expect(extendCalls[0].args[0].input.VisibilityTimeout).toBe(120)
  })
})
