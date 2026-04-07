import http from 'http'

/**
 * Minimal HTTP health check server for the Agent SDK.
 * Responds to GET /health with agent status JSON.
 */
export class HealthServer {
  #server
  #stats

  constructor(agentId, queueUrl) {
    this.#stats = {
      agent_id: agentId,
      queue_url: queueUrl,
      status: 'healthy',
      processed_count: 0,
      error_count: 0,
      uptime_start: Date.now(),
      last_processed_at: null,
    }
  }

  incrementProcessed() {
    this.#stats.processed_count++
    this.#stats.last_processed_at = new Date().toISOString()
  }

  incrementErrors() {
    this.#stats.error_count++
  }

  getSnapshot() {
    const uptimeMs = Date.now() - this.#stats.uptime_start
    const errorRate =
      this.#stats.processed_count > 0 ? this.#stats.error_count / this.#stats.processed_count : 0

    return {
      ...this.#stats,
      status: errorRate > 0.1 ? 'degraded' : 'healthy',
      uptime_seconds: Math.floor(uptimeMs / 1000),
    }
  }

  start(port) {
    this.#server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const body = JSON.stringify(this.getSnapshot())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    this.#server.listen(port, () => {
      console.log(`[agent-broker/sdk] Health server listening on :${port}`)
    })

    return this.#server
  }

  stop() {
    return new Promise((resolve) => this.#server?.close(resolve))
  }
}
