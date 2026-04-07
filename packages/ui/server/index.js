import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'

const fastify = Fastify({ logger: true })
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'ap-northeast-1' })

// ─── In-memory state (MVP) ────────────────────────────────────────
const events = [] // BrokerEvent[]
const agents = {} // agentId → agent status
const wsClients = new Set()

// ─── Plugins ──────────────────────────────────────────────────────
await fastify.register(cors, { origin: true })
await fastify.register(websocket)

// ─── WebSocket: real-time event push ─────────────────────────────
fastify.get('/ws/events', { websocket: true }, (socket) => {
  wsClients.add(socket)
  socket.on('close', () => wsClients.delete(socket))
})

const broadcast = (data) => {
  const payload = JSON.stringify(data)
  for (const client of wsClients) {
    try {
      client.send(payload)
    } catch {
      /* ignore disconnected clients */
    }
  }
}

// ─── REST: Event Log ─────────────────────────────────────────────
fastify.get('/api/events', async () => {
  return events.slice(-100).reverse()
})

fastify.get('/api/events/:event_id', async (req, reply) => {
  const found = events.find((e) => e.event_id === req.params.event_id)
  if (!found) return reply.status(404).send({ error: 'Not found' })
  return found
})

// Internal endpoint — called when a new event is received from SQS subscription
fastify.post('/internal/events', async (req, reply) => {
  const event = req.body
  event._received_at = new Date().toISOString()
  event._status = 'pending'
  events.push(event)
  broadcast({ type: 'event', data: event })
  return reply.status(201).send({ ok: true })
})

// Internal endpoint — update event status (processing / done / failed)
fastify.patch('/internal/events/:event_id', async (req, reply) => {
  const found = events.find((e) => e.event_id === req.params.event_id)
  if (!found) return reply.status(404).send({ error: 'Not found' })
  const { status } = req.body
  if (status) found._status = status
  if (status === 'done') found._completed_at = new Date().toISOString()
  broadcast({
    type: 'event_update',
    data: { event_id: found.event_id, _status: found._status, _completed_at: found._completed_at },
  })
  return { ok: true }
})

// ─── REST: Agent Health ───────────────────────────────────────────
fastify.get('/api/agents', async () => {
  const now = Date.now()
  return Object.values(agents).map((agent) => {
    const lastSeen = agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).getTime() : 0
    const elapsed = now - lastSeen
    let status = 'offline'
    if (elapsed < 60_000) status = 'healthy'
    else if (elapsed < 300_000) status = 'degraded'
    const errorRate = agent.processed_count > 0 ? agent.error_count / agent.processed_count : 0
    if (status !== 'offline' && errorRate > 0.1) status = 'degraded'
    return { ...agent, status }
  })
})

fastify.post('/api/agents/heartbeat', async (req, reply) => {
  const { agent_id, ...stats } = req.body
  if (!agent_id) return reply.status(400).send({ error: 'agent_id required' })
  agents[agent_id] = { agent_id, ...stats, last_heartbeat_at: new Date().toISOString() }
  broadcast({ type: 'agent', data: agents[agent_id] })
  return { ok: true }
})

// ─── REST: Queue Monitor (MVP — SQS attributes) ───────────────────
const QUEUE_URLS = process.env.QUEUE_URLS ? JSON.parse(process.env.QUEUE_URLS) : []

fastify.get('/api/queues', async () => {
  if (!QUEUE_URLS.length) return []

  const results = await Promise.allSettled(
    QUEUE_URLS.map(async (url) => {
      const data = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        }),
      )
      const attrs = data.Attributes || {}
      return {
        url,
        name: url.split('/').pop(),
        depth: parseInt(attrs.ApproximateNumberOfMessages || '0', 10),
        in_flight: parseInt(attrs.ApproximateNumberOfMessagesNotVisible || '0', 10),
      }
    }),
  )

  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
})

// ─── Start ────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10)
await fastify.listen({ port: PORT, host: '0.0.0.0' })
