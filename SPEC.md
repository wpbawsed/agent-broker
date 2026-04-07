# Agent Broker — 技術 Spec 文件

> 本文件為實作規格，供 AI 或工程師直接依照執行。

---

## 技術棧

```
後端 Runtime：  Node.js 22+
後端框架：      Fastify 4.x（UI API Server）
前端框架：      Vue.js 3.x + Vite + Pinia
部署：          Terraform 1.7+
Broker：        AWS SNS + SQS
Connector：     AWS Lambda（Node.js 22）
API Gateway：   AWS API Gateway v2（HTTP API）
狀態儲存：      AWS DynamoDB（對話狀態）
套件管理：      pnpm workspaces（monorepo）
```

---

## Repo 結構

```
agent-broker/
  ├── packages/
  │   ├── core/                   # 共用 schema、工具函式、型別定義
  │   │   ├── src/
  │   │   │   ├── schema.js       # Event schema 定義與驗證
  │   │   │   ├── reply.js        # reply_to 解析與發送
  │   │   │   └── index.js
  │   │   └── package.json
  │   │
  │   ├── sdk/                    # Agent 接入 SDK（發布至 npm）
  │   │   ├── src/
  │   │   │   ├── consumer.js     # SQS consumer
  │   │   │   ├── health.js       # Health check 回報
  │   │   │   └── index.js
  │   │   └── package.json
  │   │
  │   └── ui/                     # Vue.js Dashboard
  │       ├── src/
  │       │   ├── views/
  │       │   │   ├── EventLog.vue
  │       │   │   ├── AgentHealth.vue
  │       │   │   └── QueueMonitor.vue
  │       │   ├── stores/         # Pinia stores
  │       │   ├── App.vue
  │       │   └── main.js
  │       └── package.json
  │
  ├── connectors/
  │   ├── slack/                  # Slack Lambda
  │   │   ├── src/
  │   │   │   ├── index.js        # Lambda handler
  │   │   │   ├── verify.js       # Slack Signing Secret 驗證
  │   │   │   └── transform.js    # 轉換為標準 Event
  │   │   └── package.json
  │   │
  │   └── jira/                   # Jira Lambda
  │       ├── src/
  │       │   ├── index.js
  │       │   ├── verify.js
  │       │   └── transform.js
  │       └── package.json
  │
  ├── infra/                      # Terraform
  │   ├── main.tf
  │   ├── variables.tf
  │   ├── outputs.tf
  │   ├── terraform.tfvars.example
  │   └── modules/
  │       ├── messaging/          # SNS + SQS
  │       ├── connector/          # API Gateway + Lambda
  │       └── storage/            # DynamoDB
  │
  ├── examples/
  │   ├── devops-agent/           # 範例 DevOps Agent
  │   └── report-agent/           # 範例 Report Agent
  │
  ├── pnpm-workspace.yaml
  ├── package.json
  └── README.md
```

---

## Event Schema（核心契約）

所有進入系統的事件，無論來源為何，都必須轉換為以下標準格式：

```typescript
// packages/core/src/schema.js

interface BrokerEvent {
  // 識別
  event_id: string;          // UUID v4，由 Connector 產生
  created_at: string;        // ISO 8601 UTC

  // 來源
  source: "slack" | "jira" | "github" | "webhook" | "agent";
  source_meta: {
    // Slack 專用
    channel_id?: string;     // Slack channel ID，例如 C1234567
    thread_ts?: string;      // Slack thread timestamp，用於對話追蹤
    user_id?: string;        // Slack user ID
    // Jira 專用
    issue_key?: string;      // 例如 PROJ-123
    issue_type?: string;     // Story / Bug / Task
    project_key?: string;
    // 共用
    raw?: object;            // 原始 payload，保留供 debug 用
  };

  // 內容
  text: string;              // 自然語言描述，Agent 主要讀這個
  attachments?: Array<{
    type: "file" | "image" | "url";
    url: string;
    name?: string;
  }>;

  // 回覆設定
  reply_to: {
    channel: string;         // 格式："slack://C1234567" | "jira://PROJ-123" | "webhook://https://..."
    thread_ts?: string;      // 若要回到同一個 Slack thread
    metadata?: object;       // 回覆時附帶的額外資訊
  };

  // 路由
  requested_by: string;      // 誰發的，例如 "slack://U1234567" 或 "jira://john@company.com"
  tags?: string[];           // 路由用的標籤，例如 ["k8s", "production", "urgent"]
  priority?: "low" | "normal" | "high";  // 預設 normal

  // 生命週期
  ttl?: number;              // 秒，超過此時間未處理視為過期，預設 3600
}
```

### Schema 驗證

使用 `zod` 進行 runtime 驗證：

```javascript
// packages/core/src/schema.js
import { z } from 'zod'

export const BrokerEventSchema = z.object({
  event_id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.enum(['slack', 'jira', 'github', 'webhook', 'agent']),
  source_meta: z.object({
    channel_id: z.string().optional(),
    thread_ts: z.string().optional(),
    user_id: z.string().optional(),
    issue_key: z.string().optional(),
    issue_type: z.string().optional(),
    project_key: z.string().optional(),
    raw: z.record(z.unknown()).optional(),
  }),
  text: z.string().min(1),
  attachments: z.array(z.object({
    type: z.enum(['file', 'image', 'url']),
    url: z.string().url(),
    name: z.string().optional(),
  })).optional(),
  reply_to: z.object({
    channel: z.string(),
    thread_ts: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  requested_by: z.string(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  ttl: z.number().int().positive().default(3600),
})
```

---

## Connector 規格

### 共用規則

每個 Connector 都是一個獨立的 AWS Lambda，需要做到：

1. **立刻回 200**：在任何處理之前先回應，避免 timeout
2. **驗證來源**：各平台有自己的驗證方式
3. **轉換格式**：將原始 payload 轉換為標準 BrokerEvent
4. **發布到 SNS**：publish 到統一的 SNS Topic

```javascript
// 共用的 Lambda 回應格式
const respond = (statusCode, body = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
```

### Slack Connector

**觸發方式**：API Gateway → Lambda

**特殊處理**：

```javascript
// connectors/slack/src/index.js

export const handler = async (event) => {
  const body = JSON.parse(event.body || '{}')

  // Step 1：Slack URL verification（首次設定時）
  if (body.type === 'url_verification') {
    return respond(200, { challenge: body.challenge })
  }

  // Step 2：立刻回 200（Slack 要求 3 秒內）
  // 後續處理非同步進行
  const response = respond(200)

  // Step 3：驗證 Signing Secret
  if (!verifySlackSignature(event)) {
    console.warn('Invalid Slack signature')
    return respond(401)
  }

  // Step 4：過濾 bot 自己的訊息（避免 loop）
  if (body.event?.bot_id) return respond(200)

  // Step 5：轉換為標準 Event
  const brokerEvent = transformSlackEvent(body)

  // Step 6：發布到 SNS
  await publishToSNS(brokerEvent)

  return response
}
```

**Signing Secret 驗證**：

```javascript
// connectors/slack/src/verify.js
import crypto from 'crypto'

export const verifySlackSignature = (lambdaEvent) => {
  const timestamp = lambdaEvent.headers['x-slack-request-timestamp']
  const signature = lambdaEvent.headers['x-slack-signature']
  const body = lambdaEvent.body

  // 防止 replay attack（5 分鐘內）
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > 300) return false

  const sigBase = `v0:${timestamp}:${body}`
  const hmac = crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(`v0=${hmac}`),
    Buffer.from(signature)
  )
}
```

**事件轉換**：

```javascript
// connectors/slack/src/transform.js
import { randomUUID } from 'crypto'

export const transformSlackEvent = (payload) => ({
  event_id: randomUUID(),
  created_at: new Date().toISOString(),
  source: 'slack',
  source_meta: {
    channel_id: payload.event?.channel,
    thread_ts: payload.event?.thread_ts || payload.event?.ts,
    user_id: payload.event?.user,
    raw: payload,
  },
  // 移除 @mention 的 bot ID
  text: payload.event?.text?.replace(/<@[A-Z0-9]+>/g, '').trim() || '',
  reply_to: {
    channel: `slack://${payload.event?.channel}`,
    thread_ts: payload.event?.thread_ts || payload.event?.ts,
  },
  requested_by: `slack://${payload.event?.user}`,
  tags: [],
  priority: 'normal',
  ttl: 3600,
})
```

### Jira Connector

**觸發方式**：API Gateway → Lambda

**驗證方式**：Jira Webhook Secret（query string 或 header）

```javascript
// connectors/jira/src/verify.js
export const verifyJiraWebhook = (event) => {
  const secret = event.queryStringParameters?.token
    || event.headers?.['x-jira-webhook-token']
  return secret === process.env.JIRA_WEBHOOK_SECRET
}
```

**事件轉換**：

```javascript
// connectors/jira/src/transform.js
import { randomUUID } from 'crypto'

export const transformJiraEvent = (payload) => {
  const issue = payload.issue || {}
  const fields = issue.fields || {}

  return {
    event_id: randomUUID(),
    created_at: new Date().toISOString(),
    source: 'jira',
    source_meta: {
      issue_key: issue.key,
      issue_type: fields.issuetype?.name,
      project_key: fields.project?.key,
      raw: payload,
    },
    text: `${fields.summary || ''}\n${fields.description || ''}`.trim(),
    reply_to: {
      channel: `jira://${issue.key}`,
    },
    requested_by: `jira://${payload.user?.emailAddress || payload.user?.name}`,
    // 從 label 自動提取 tags
    tags: (fields.labels || []),
    priority: mapJiraPriority(fields.priority?.name),
    ttl: 7200,
  }
}

const mapJiraPriority = (jiraPriority) => {
  const map = { Highest: 'high', High: 'high', Medium: 'normal', Low: 'low', Lowest: 'low' }
  return map[jiraPriority] || 'normal'
}
```

---

## SNS → SQS 路由規則

### SNS Topic

一個統一的 SNS Topic：`agent-broker-events`

所有 Connector 都 publish 到這個 Topic。

### SQS Queues

每種 Agent 角色對應一個 SQS Queue：

```
agent-broker-events（SNS Topic）
    │
    ├──► sqs-qa-agent（問答型 Agent）
    │     └── sqs-qa-agent-dlq（Dead Letter Queue）
    │
    ├──► sqs-task-agent（任務執行型 Agent）
    │     └── sqs-task-agent-dlq
    │
    └──► sqs-notify-agent（通知型 Agent）
          └── sqs-notify-agent-dlq
```

### SNS Filter Policy（依 tags 路由）

```json
// sqs-task-agent 只收 Jira 來源或有 agent-task tag 的事件
{
  "source": ["jira"],
  "tags": ["agent-task"]
}

// sqs-qa-agent 只收 Slack 來源
{
  "source": ["slack"]
}
```

### SQS 設定

```hcl
# 所有 Queue 的共用設定
visibility_timeout_seconds = 300   # 5 分鐘，給 Agent 足夠執行時間
message_retention_seconds  = 86400 # 1 天
receive_wait_time_seconds  = 20    # Long polling

# Dead Letter Queue
max_receive_count = 3              # 失敗 3 次後移到 DLQ
```

---

## Agent SDK 規格

### 安裝

```bash
npm install @agent-broker/sdk
```

### 基本使用

```javascript
import { AgentConsumer } from '@agent-broker/sdk'

const agent = new AgentConsumer({
  queueUrl: process.env.QUEUE_URL,       // SQS Queue URL
  agentId: 'my-devops-agent',            // 唯一識別 ID
  region: process.env.AWS_REGION || 'ap-northeast-1',
  concurrency: 1,                         // 同時處理幾個訊息，預設 1
  healthPort: 3001,                       // Health check HTTP port
})

// 處理訊息
agent.on('message', async (event, ctx) => {
  console.log(`收到任務：${event.text}`)

  // 你的 agent 邏輯
  const result = await doSomething(event)

  // 回覆到 reply_to 指定的管道
  await ctx.reply(result)

  // 標記處理完成（從 SQS 刪除）
  await ctx.done()
})

// 錯誤處理
agent.on('error', async (error, event, ctx) => {
  console.error(error)
  // 不呼叫 ctx.done() → 訊息會回到 queue 重試
})

agent.start()
```

### ctx API

```javascript
// 回覆到 reply_to 管道
await ctx.reply(text: string, options?: { attachments?: [] })

// 標記完成，從 SQS 刪除
await ctx.done()

// 延長 visibility timeout（長時間任務用）
await ctx.extend(seconds: number)

// 取得原始 SQS message
ctx.rawMessage

// 取得標準化 BrokerEvent
ctx.event
```

### Health Check

SDK 內建 HTTP server，回應 `/health`：

```json
// GET http://localhost:3001/health
{
  "agent_id": "my-devops-agent",
  "status": "healthy",
  "queue_url": "https://sqs...",
  "processed_count": 42,
  "error_count": 1,
  "uptime_seconds": 3600,
  "last_processed_at": "2026-03-26T10:00:00Z"
}
```

---

## UI Dashboard 規格

### 技術

```
框架：  Vue 3 + Composition API
狀態：  Pinia
UI：    Tailwind CSS
圖表：  Chart.js
即時：  WebSocket（連後端 Fastify server）
```

### 頁面規格

#### 1. Event Log（主頁）

即時顯示所有進入 Broker 的事件。

```
欄位：
  - 時間（相對時間，例如「2 分鐘前」）
  - 來源（Slack / Jira / Webhook）圖示
  - 文字預覽（前 80 字）
  - 狀態（pending / processing / done / failed）
  - 路由到哪個 Queue
  - requested_by

功能：
  - 即時更新（WebSocket）
  - 過濾：來源 / 狀態 / 時間範圍
  - 點擊展開：完整 event JSON
  - 搜尋：text 內容搜尋
```

#### 2. Agent Health

```
顯示每個 Agent 的狀態卡片：

┌─────────────────────────────┐
│ 🟢 devops-agent             │
│ Queue: sqs-task-agent       │
│ 處理數：42  錯誤：1          │
│ 平均耗時：3.2s              │
│ 上線時間：2h 30m            │
│ 最後處理：2 分鐘前           │
└─────────────────────────────┘

狀態：
  🟢 healthy（最近 1 分鐘有 heartbeat）
  🟡 degraded（錯誤率 > 10%）
  🔴 offline（超過 5 分鐘無 heartbeat）
```

#### 3. Queue Monitor

```
每個 Queue 的即時狀態：

Queue 名稱          深度    DLQ    處理速率
sqs-qa-agent         3      0      12/min
sqs-task-agent       1      2      3/min
sqs-notify-agent     0      0      8/min

警告條件：
  - Queue 深度 > 50（積壓警告）
  - DLQ 深度 > 0（失敗警告，需要人工介入）
```

### 後端 API Server（Fastify）

```javascript
// UI 後端需要的 API

// Event Log
GET  /api/events              // 取得最近 100 筆 events
GET  /api/events/:event_id    // 取得單一 event 詳情
WS   /ws/events               // WebSocket，即時推送新 event

// Agent Health
GET  /api/agents              // 取得所有 Agent 狀態
POST /api/agents/heartbeat    // Agent SDK 呼叫，更新 heartbeat

// Queue Monitor
GET  /api/queues              // 取得所有 Queue 的 CloudWatch 指標
```

---

## Terraform 規格

### 目錄結構

```
infra/
  ├── main.tf           # 主要入口，呼叫各 module
  ├── variables.tf      # 變數定義
  ├── outputs.tf        # 輸出（Queue URL、API endpoint 等）
  ├── terraform.tfvars.example
  └── modules/
      ├── messaging/    # SNS + SQS
      │   ├── main.tf
      │   ├── variables.tf
      │   └── outputs.tf
      ├── connector/    # API Gateway + Lambda
      │   ├── main.tf
      │   ├── variables.tf
      │   └── outputs.tf
      └── storage/      # DynamoDB（對話狀態）
          ├── main.tf
          ├── variables.tf
          └── outputs.tf
```

### 必要變數（terraform.tfvars）

```hcl
# terraform.tfvars.example
aws_region           = "ap-northeast-1"
project_name         = "agent-broker"
environment          = "prod"

slack_signing_secret = ""   # 從 Slack App 設定取得
jira_webhook_secret  = ""   # 自訂，填到 Jira Webhook URL
```

### 主要資源

```hcl
# modules/messaging/main.tf

# SNS Topic
resource "aws_sns_topic" "events" {
  name = "${var.project_name}-events"
}

# 每個 Queue 的模式（以 task-agent 為例）
resource "aws_sqs_queue" "task_agent_dlq" {
  name                      = "${var.project_name}-task-agent-dlq"
  message_retention_seconds = 1209600  # 14 天
}

resource "aws_sqs_queue" "task_agent" {
  name                       = "${var.project_name}-task-agent"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.task_agent_dlq.arn
    maxReceiveCount     = 3
  })
}

# SNS → SQS 訂閱（含 Filter Policy）
resource "aws_sns_topic_subscription" "task_agent" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.task_agent.arn

  filter_policy = jsonencode({
    source = ["jira"]
  })
}
```

### Outputs

```hcl
# outputs.tf
output "slack_webhook_url" {
  value = module.connector_slack.api_endpoint
  description = "填到 Slack App Event Subscriptions 的 URL"
}

output "jira_webhook_url" {
  value = module.connector_jira.api_endpoint
  description = "填到 Jira Webhook 設定的 URL"
}

output "qa_agent_queue_url" {
  value = module.messaging.qa_agent_queue_url
  description = "問答 Agent 的 SQS Queue URL"
}

output "task_agent_queue_url" {
  value = module.messaging.task_agent_queue_url
  description = "任務執行 Agent 的 SQS Queue URL"
}
```

---

## IAM 權限設計（最小權限原則）

```
Slack Lambda：
  ✅ sns:Publish（只能發到 agent-broker-events）

Jira Lambda：
  ✅ sns:Publish（只能發到 agent-broker-events）

Agent（SDK 使用者）：
  ✅ sqs:ReceiveMessage（只能從自己的 queue）
  ✅ sqs:DeleteMessage
  ✅ sqs:ChangeMessageVisibility

UI Server：
  ✅ sqs:GetQueueAttributes（取得 queue 深度）
  ✅ cloudwatch:GetMetricData（取得 queue 指標）
```

---

## 實作順序

### Phase 1：MVP（目標：能跑起來）

```
Step 1：monorepo 設定
  - pnpm workspace
  - 共用 eslint / prettier
  - packages/core 的 schema.js

Step 2：Terraform infra
  - modules/messaging（SNS + 3個 SQS）
  - modules/connector（API Gateway + 2個 Lambda slot）
  - modules/storage（DynamoDB，先建好備用）

Step 3：Slack Connector Lambda
  - verify.js（Signing Secret）
  - transform.js
  - index.js
  - 部署到 Lambda

Step 4：Agent SDK（packages/sdk）
  - consumer.js（SQS long polling）
  - health.js（HTTP server）
  - 發布到本地 npm

Step 5：範例 Agent（examples/devops-agent）
  - 使用 SDK
  - 印出收到的 event
  - 回覆 "收到了" 到 Slack

Step 6：UI MVP（packages/ui）
  - Event Log 頁面
  - 連 WebSocket 即時顯示
```

### Phase 2：完整功能

```
Step 7：Jira Connector Lambda
Step 8：Agent Health 頁面
Step 9：Queue Monitor 頁面
Step 10：DynamoDB 對話狀態（thread_ts ↔ session_id）
Step 11：Routing Rules UI
Step 12：Audit Log
```

---

## 環境變數清單

### Slack Lambda

```
SLACK_SIGNING_SECRET=   # Slack App 的 Signing Secret
SNS_TOPIC_ARN=          # agent-broker-events 的 ARN
AWS_REGION=             # 例如 ap-northeast-1
```

### Jira Lambda

```
JIRA_WEBHOOK_SECRET=    # 自訂的 secret token
SNS_TOPIC_ARN=
AWS_REGION=
```

### Agent SDK（使用者設定）

```
QUEUE_URL=              # SQS Queue URL
AWS_REGION=
AWS_ACCESS_KEY_ID=      # 或使用 IAM Role（推薦）
AWS_SECRET_ACCESS_KEY=
```

### UI Server

```
AWS_REGION=
QA_QUEUE_URL=
TASK_QUEUE_URL=
NOTIFY_QUEUE_URL=
PORT=3000               # UI Server port，預設 3000
```

---

## 測試策略

```
Unit Test：
  - schema validation（zod）
  - Slack verify（mock headers）
  - transform 函式（snapshot test）

Integration Test：
  - LocalStack 模擬 SNS/SQS
  - Connector → SNS → SQS 完整流程

E2E Test：
  - 使用 Slack API 發測試訊息
  - 驗證 event 進到 SQS
  - 驗證 example agent 回覆
```

---

## README 結構（給最終使用者）

```markdown
# Agent Broker

> 讓任何 Agent 都能接收外部事件的基礎建設層

## 30 秒快速了解

[架構圖]

## 快速開始

1. clone repo
2. 填寫 terraform.tfvars
3. terraform apply
4. 設定 Slack App URL
5. 用 SDK 接你的 Agent

## Connectors
- Slack
- Jira
- Generic Webhook

## Agent SDK 使用方式

## 部署

## 貢獻指南
```
