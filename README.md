# Agent Broker SDK

**BrokerEvent schema + AgentConsumer SDK** — 讓 Agent 透過 AWS SQS 消費標準化事件，並回覆到來源平台（Slack / Jira）。

> 基礎設施（Connectors、Lambda、Terraform）已移至 [agent-manager](../agent-manager)，此 repo 僅保留可發布的 npm 套件與 example。

---

## Packages

```
agent-broker/
  ├── packages/
  │   ├── core/   # @wpbawsed/agent-broker-core — BrokerEvent schema + reply dispatcher
  │   └── sdk/    # @wpbawsed/agent-broker-sdk  — AgentConsumer (SQS poller) + health server
  └── examples/
      └── devops-agent/  # Example Agent using @wpbawsed/agent-broker-sdk
```

---

## Install

```bash
npm install @wpbawsed/agent-broker-sdk
# peer dep:
npm install @wpbawsed/agent-broker-core
```

---

## Usage

```js
import { AgentConsumer } from '@wpbawsed/agent-broker-sdk'

const agent = new AgentConsumer({
  queueUrl: process.env.QUEUE_URL,
  agentId: 'my-agent',
})

agent.on('message', async (event, ctx) => {
  const result = await yourLogic(event.text)
  await ctx.reply(result)
  await ctx.done()
})

agent.start()
// Health check: GET http://localhost:3001/health
```

---

## Development

```bash
pnpm install
pnpm test       # run all package tests
pnpm lint       # lint all packages
```

---

## License

MIT
