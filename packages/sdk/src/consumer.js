import { EventEmitter } from 'events'
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs'
import { dispatchReply } from '@agent-broker/core/reply'
import { HealthServer } from './health.js'

/**
 * AgentConsumer — SQS long-polling consumer for Agent Broker agents.
 *
 * @example
 * const agent = new AgentConsumer({
 *   queueUrl: process.env.QUEUE_URL,
 *   agentId: 'my-devops-agent',
 * })
 * agent.on('message', async (event, ctx) => {
 *   const result = await doSomething(event)
 *   await ctx.reply(result)
 *   await ctx.done()
 * })
 * agent.start()
 */
export class AgentConsumer extends EventEmitter {
  #client
  #queueUrl
  #agentId
  #concurrency
  #healthServer
  #running = false
  #active = 0
  #dashboardUrl = null
  #heartbeatTimer = null

  constructor({
    queueUrl,
    agentId,
    region = process.env.AWS_REGION || 'ap-northeast-1',
    concurrency = 1,
    healthPort = 3001,
    replyOptions = {},
    dashboardUrl = null,
  }) {
    super()
    if (!queueUrl) throw new TypeError('queueUrl is required')
    if (!agentId) throw new TypeError('agentId is required')

    this.#queueUrl = queueUrl
    this.#agentId = agentId
    this.#concurrency = concurrency
    this.#client = new SQSClient({ region })
    this.#healthServer = new HealthServer(agentId, queueUrl)
    this._replyOptions = replyOptions
    this._healthPort = healthPort
    this.#dashboardUrl = dashboardUrl
  }

  get agentId() {
    return this.#agentId
  }

  /**
   * Start polling SQS and the health server.
   */
  start() {
    if (this.#running) return
    this.#running = true
    this.#healthServer.start(this._healthPort)
    this.#poll()
    if (this.#dashboardUrl) {
      this.#sendHeartbeat()
      this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), 30_000)
    }
  }

  /**
   * Gracefully stop the consumer.
   */
  async stop() {
    this.#running = false
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer)
    await this.#healthServer.stop()
  }

  #sendHeartbeat() {
    const snapshot = this.#healthServer.getSnapshot()
    fetch(`${this.#dashboardUrl}/api/agents/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }).catch(() => {}) // fire-and-forget, best-effort
  }

  #reportEvent(brokerEvent) {
    if (!this.#dashboardUrl) return
    fetch(`${this.#dashboardUrl}/internal/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brokerEvent),
    }).catch(() => {}) // fire-and-forget, best-effort
  }

  #updateEventStatus(eventId, status) {
    if (!this.#dashboardUrl) return
    fetch(`${this.#dashboardUrl}/internal/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {}) // fire-and-forget, best-effort
  }

  async #poll() {
    while (this.#running) {
      if (this.#active >= this.#concurrency) {
        await sleep(500)
        continue
      }

      let messages
      try {
        const response = await this.#client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.#queueUrl,
            MaxNumberOfMessages: this.#concurrency - this.#active,
            WaitTimeSeconds: 20,
            AttributeNames: ['All'],
          }),
        )
        messages = response.Messages || []
      } catch (err) {
        this.emit('error', err)
        await sleep(2000)
        continue
      }

      if (messages.length === 0) {
        // Yield to the macrotask queue to avoid starving other callbacks
        // when the mock/SQS returns immediately with no messages.
        await sleep(100)
        continue
      }

      for (const msg of messages) {
        this.#active++
        this.#processMessage(msg).finally(() => {
          this.#active--
        })
      }
    }
  }

  async #processMessage(msg) {
    let brokerEvent
    try {
      const snsWrapper = JSON.parse(msg.Body)
      // SNS wraps message in { Message: "..." }
      brokerEvent = JSON.parse(snsWrapper.Message ?? msg.Body)
    } catch {
      console.error('[agent-broker/sdk] Failed to parse message body')
      return
    }

    this.#reportEvent(brokerEvent)
    this.#updateEventStatus(brokerEvent.event_id, 'processing')
    const ctx = this.#makeCtx(msg, brokerEvent)

    try {
      await new Promise((resolve, reject) => {
        const result = this.emit('message', brokerEvent, ctx)
        if (!result) resolve() // No listeners — auto-ack
        ctx._resolve = resolve
        ctx._reject = reject
      })
      this.#healthServer.incrementProcessed()
      this.#updateEventStatus(brokerEvent.event_id, 'done')
    } catch (err) {
      this.#healthServer.incrementErrors()
      this.#updateEventStatus(brokerEvent.event_id, 'failed')
      this.emit('error', err, brokerEvent, ctx)
    }
  }

  #makeCtx(rawMsg, brokerEvent) {
    const self = this
    const ctx = {
      rawMessage: rawMsg,
      event: brokerEvent,
      _resolve: null,
      _reject: null,

      /**
       * Delete the message from SQS (mark as done).
       */
      async done() {
        await self.#client.send(
          new DeleteMessageCommand({
            QueueUrl: self.#queueUrl,
            ReceiptHandle: rawMsg.ReceiptHandle,
          }),
        )
        ctx._resolve?.()
      },

      /**
       * Extend the visibility timeout of the message.
       * @param {number} seconds
       */
      async extend(seconds) {
        await self.#client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: self.#queueUrl,
            ReceiptHandle: rawMsg.ReceiptHandle,
            VisibilityTimeout: seconds,
          }),
        )
      },

      /**
       * Send a reply to the reply_to channel specified in the event.
       * @param {string} text
       * @param {object} [options]
       */
      async reply(text, options = {}) {
        if (!brokerEvent.reply_to?.channel) {
          throw new Error('Event has no reply_to.channel')
        }
        await dispatchReply(brokerEvent.reply_to, text, {
          ...self._replyOptions,
          ...options,
        })
      },
    }
    return ctx
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
