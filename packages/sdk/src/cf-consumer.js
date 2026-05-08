import { EventEmitter } from 'events'
import { dispatchReply } from '@wpbawsed/agent-broker-core/reply'
import { HealthServer } from './health.js'

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

/**
 * QueueConsumer — Queue HTTP pull consumer for Agent Broker agents.
 *
 * Polls the queue REST API using the pull model. Emits the same
 * 'message' events as AgentConsumer so it can be used as a drop-in
 * replacement when the broker is cloud-hosted.
 *
 * @example
 * const agent = new QueueConsumer({
 *   accountId: process.env.CF_ACCOUNT_ID,
 *   queueId: process.env.CF_QUEUE_ID,       // from broker's queueId
 *   apiToken: process.env.CF_API_TOKEN,
 *   agentId: 'my-devops-agent',
 * })
 * agent.on('message', async (event, ctx) => {
 *   const result = await doSomething(event)
 *   await ctx.reply(result)
 *   await ctx.done()
 * })
 * agent.start()
 */
export class QueueConsumer extends EventEmitter {
  #accountId
  #queueId
  #apiToken
  #agentId
  #tenantId
  #concurrency
  #healthServer
  #running = false
  #active = 0
  #dashboardUrl = null
  #heartbeatTimer = null
  #pollIntervalMs

  constructor({
    accountId,
    queueId,
    apiToken,
    agentId,
    tenantId = 'default',
    concurrency = 5,
    pollIntervalMs = 2000,
    healthPort = 3001,
    replyOptions = {},
    dashboardUrl = null,
  }) {
    super()
    if (!accountId) throw new TypeError('accountId is required')
    if (!queueId) throw new TypeError('queueId is required')
    if (!apiToken) throw new TypeError('apiToken is required')
    if (!agentId) throw new TypeError('agentId is required')

    this.#accountId = accountId
    this.#queueId = queueId
    this.#apiToken = apiToken
    this.#agentId = agentId
    this.#tenantId = tenantId
    this.#concurrency = concurrency
    this.#pollIntervalMs = pollIntervalMs
    this.#healthServer = new HealthServer(agentId, `cf-queue:${queueId}`)
    this._replyOptions = replyOptions
    this._healthPort = healthPort
    this.#dashboardUrl = dashboardUrl
  }

  get agentId() {
    return this.#agentId
  }

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
      body: JSON.stringify({
        ...snapshot,
        tenant_id: this.#tenantId,
        active_jobs: this.#active,
      }),
    }).catch(() => {})
  }

  #cfRequest(path, options = {}) {
    return fetch(`${CF_API_BASE}/accounts/${this.#accountId}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  }

  async #pullMessages(batchSize) {
    const res = await this.#cfRequest(`/queues/${this.#queueId}/messages/pull`, {
      method: 'POST',
      body: JSON.stringify({ batch_size: batchSize, visibility_timeout: 30 }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`CF Queue pull failed: ${res.status} ${body}`)
    }
    const data = await res.json()
    return data.result?.messages ?? []
  }

  async #ackMessages(leaseIds) {
    if (leaseIds.length === 0) return
    const res = await this.#cfRequest(`/queues/${this.#queueId}/messages/ack`, {
      method: 'POST',
      body: JSON.stringify({ acks: leaseIds.map((id) => ({ lease_id: id })) }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[cf-consumer] ACK failed: ${res.status} ${body}`)
    }
  }

  async #poll() {
    while (this.#running) {
      if (this.#active >= this.#concurrency) {
        await sleep(500)
        continue
      }

      let messages
      try {
        const batchSize = Math.min(10, this.#concurrency - this.#active)
        messages = await this.#pullMessages(batchSize)
      } catch (err) {
        this.emit('error', err)
        await sleep(5000)
        continue
      }

      if (messages.length === 0) {
        await sleep(this.#pollIntervalMs)
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
      brokerEvent = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body
      // CF Queue body may be double-JSON encoded
      if (typeof brokerEvent === 'string') {
        brokerEvent = JSON.parse(brokerEvent)
      }
    } catch {
      console.error('[cf-consumer] Failed to parse message body')
      // ACK malformed messages so they don't loop forever
      await this.#ackMessages([msg.lease_id]).catch(() => {})
      return
    }

    const ctx = this.#makeCtx(msg, brokerEvent)

    try {
      await new Promise((resolve, reject) => {
        const result = this.emit('message', brokerEvent, ctx)
        if (!result) resolve() // No listeners — auto-ack
        ctx._resolve = resolve
        ctx._reject = reject
      })
      this.#healthServer.incrementProcessed()
    } catch (err) {
      this.#healthServer.incrementErrors()
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
       * ACK the message (mark as done and delete from queue).
       */
      async done() {
        await self.#ackMessages([rawMsg.lease_id])
        ctx._resolve?.()
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
