# Agent Broker

**事件入口治理平台** — 將 Slack、Jira 等外部事件可靠地路由到 AI Agent。

```
Slack / Jira / Webhook
        │
        ▼
  API Gateway + Lambda (Connector)
        │  verify → transform → BrokerEvent
        ▼
     AWS SNS
        │  filter by source / tags
        ▼
  AWS SQS Queues
    ├── qa-agent       (Slack → 問答型 Agent)
    ├── task-agent     (Jira → 任務執行型 Agent)
    └── notify-agent   (all → 通知型 Agent)
        │
        ▼
  Your Agent (using @agent-broker/sdk)
        │  ctx.reply() → Slack thread / Jira comment
        ▼
   Agent Broker UI Dashboard
```

---

## Monorepo Structure

```
agent-broker/
  ├── packages/
  │   ├── core/          # BrokerEvent schema + reply dispatcher
  │   ├── sdk/           # AgentConsumer (SQS poller) + health server
  │   └── ui/            # Vue 3 dashboard + Fastify API server
  ├── connectors/
  │   ├── slack/         # Slack Events API → SNS Lambda
  │   └── jira/          # Jira Webhook → SNS Lambda
  ├── infra/             # Terraform (SNS, SQS, API Gateway, Lambda, DynamoDB)
  └── examples/
      └── devops-agent/  # Example Agent using @agent-broker/sdk
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9
- AWS CLI configured
- Terraform ≥ 1.7

### Install dependencies

```bash
pnpm install
```

### Run tests

```bash
pnpm test
# or per package:
pnpm --filter @agent-broker/core test
pnpm --filter @agent-broker/connector-slack test
```

---

## Deploy to AWS

### 1. Configure variables

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Fill in slack_signing_secret and jira_webhook_secret
```

### 2. Build Lambda zips

```bash
pnpm --filter @agent-broker/connector-slack build
pnpm --filter @agent-broker/connector-jira build
```

### 3. Deploy

```bash
cd infra
terraform init
terraform apply
```

### 4. Note the outputs

```
slack_webhook_url    → paste into Slack App → Event Subscriptions
jira_webhook_url     → paste into Jira → System → Webhooks
qa_agent_queue_url   → set as QUEUE_URL for your question-answering Agent
task_agent_queue_url → set as QUEUE_URL for your task-execution Agent
```

---

## Run an Agent

```bash
export QUEUE_URL="<qa_agent_queue_url from terraform output>"
export SLACK_BOT_TOKEN="xoxb-..."
export AWS_REGION="ap-northeast-1"

pnpm --filter @agent-broker/example-devops-agent start
```

---

## Run the UI Dashboard

```bash
cd packages/ui
pnpm dev          # starts Fastify on :4000 + Vite dev server on :5173
```

Open http://localhost:5173

---

## Agent SDK Usage

```js
import { AgentConsumer } from '@agent-broker/sdk'

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
```

Health check: `GET http://localhost:3001/health`

---

## License

MIT
