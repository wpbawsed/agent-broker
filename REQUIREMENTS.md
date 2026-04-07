# Agent Broker — 需求文件

## 背景與問題

### 問題起源

團隊希望建立一個 AI Agent 系統，能夠：

1. 透過 Slack 對 Agent 下達指令（例如查詢 K8s 服務狀態）
2. 透過 Jira 開卡後，Agent 自動抓取任務並執行（例如更新 env、執行 helm upgrade）

在探索過程中，發現現有工具的限制：

- **Claude Cowork**：VM 網路受限，egress allowlist 有 bug（截至 2026/03 仍未修復），只有少數硬編碼域名（`api.anthropic.com`、`github.com`、`pypi.org`、`npmjs.org`）可以通過，無法打 AWS SQS、Jira、Slack 等外部 API
- **官方 Claude Code + Slack 整合**：只能單向推播，無法做到 Slack @mention 後的雙向對話
- **OpenClaw**：最接近「代理人」角色，但安全性問題多（ClawHub 供應鏈攻擊、CVE-2026-25253 等），需謹慎使用於 Production

### 核心洞察

所有工具都把「事件入口層」和「Agent 執行層」綁在一起。沒有一個工具專注於解決：

> **外部事件（Slack/Jira/Webhook）怎麼可靠地進入 Agent 生態系、怎麼路由、怎麼追蹤、Agent 掛掉怎麼辦**

---

## 解決方案定位

### 不是什麼

- ❌ 不是另一個 AI Agent Framework（不像 LangGraph、CrewAI）
- ❌ 不是 Agent 執行環境（不像 AWS AgentCore Runtime）
- ❌ 不是 Agent 之間的通訊協議（不像 Agent Gateway / A2A）
- ❌ 不是 no-code 工具（不像 n8n、Zapier）

### 是什麼

- ✅ **事件入口的治理平台**
- ✅ Agent 的基礎建設層，類比於：Kafka 不管 business logic、K8s 不管 app 做什麼
- ✅ 標準化外部事件進入 Agent 生態系的方式
- ✅ 讓任何 Agent（DevOps Agent、Report Agent、其他）都能用同一套入口

### 與現有方案的差異

| 方案 | 定位 | 差異 |
|------|------|------|
| Agent Gateway | Agent ↔ Agent / Agent ↔ Tool 的 proxy（同步） | 不處理外部事件入口，不支援 async queue |
| AWS AgentCore + SQS | AWS 幫你跑 Agent，SQS 只是觸發器 | 強綁 AWS，有費用，不開源 |
| OpenClaw Gateway | 個人助理的訊息路由 | 跟 Brain 耦合，無法單獨使用 |
| **Agent Broker（本專案）** | 純事件入口治理層 | 不管 Agent 怎麼跑，只管事件進來、路由、追蹤 |

---

## 核心設計理念

### Event-Driven，Async First

- 任何來源都往 SNS/SQS 丟，不需要即時回應
- SQS 的 Visibility Timeout 解決 Agent 掛掉的問題（任務不遺失）
- Dead Letter Queue 處理失敗的訊息

### Broker 角色彈性

```
任何來源         Broker          任何角色的 Agent
──────────       ──────          ────────────────
Slack      ──►  SNS/SQS  ──►   只聽不發（執行者）
Jira       ──►            ──►   只發不聽（通知者）
Other Agent──►            ──►   又聽又發（協調者）
Webhook    ──►            ──►   自訂組合
```

- Agent 可以「只聽不發」：consume queue，執行後直接更新 Jira
- Agent 可以「只發不聽」：執行完發 Slack 通知
- Agent 可以「又聽又發」：consume 後再 produce 到另一個 queue

### 兩種互動情境分離

**情境 A：問答型**（即時對話）
- Slack @mention → 即時回應
- 需要對話上下文（thread 對應 session）
- 使用者期待秒級回應

**情境 B：任務型**（非同步執行）
- Jira 開卡 → Agent 自動執行
- 不需要即時回應
- 完成後回報 Jira 狀態 / 發 Slack 通知

---

## 使用者與使用情境

### 主要使用者

1. **RD / DevOps 工程師**：透過 Slack 查詢 K8s 狀態、查 Log
2. **PM / 開發者**：透過 Jira 開卡委派自動化任務
3. **平台建置者**：建立自己的 Agent 並接入 Broker

### 使用情境範例

```
情境 1：RD 查 Log
  RD 在 Slack 輸入：「payment-api 最近有什麼 error？」
  → Broker 接收，路由到問答 Agent queue
  → Agent consume，執行 kubectl logs，回覆到同一個 Slack thread

情境 2：Jira 任務執行
  PM 在 Jira 建立卡片：「[Agent] 更新 production APP_VERSION=2.1.0」
  → Jira Webhook → Broker → 任務執行 Agent queue
  → Agent consume，執行 helm upgrade
  → 完成後更新 Jira 狀態 + 發 Slack 通知

情境 3：Report Agent
  排程觸發 → Broker → Report Agent queue
  → Agent 撰寫週報，上傳到 Confluence / 發信
```

---

## 功能需求

### 必要功能（MVP）

#### 上游 Connectors
- **Slack Connector**：接收 @mention，驗證 Slack Signing Secret，即時回 200，非同步發 SNS
- **Jira Connector**：接收 Webhook，驗證 token，標準化事件，發 SNS
- **Generic Webhook Connector**：接收任意 HTTP POST，轉換為標準 event

#### 標準化 Event Schema
- 統一的 JSON 格式（見 Spec 文件）
- 包含來源、回覆管道（`reply_to`）、對話 ID（`thread_id`）、TTL

#### Agent SDK（Node.js）
- 簡單的 SQS consume 介面
- 自動處理 visibility timeout、retry、delete
- Health check 回報機制

#### Web UI（Vue.js）
- Event Log：即時顯示進來的事件
- Agent Health：顯示每個 Agent 的狀態
- Queue Monitor：SQS queue 深度

#### Infrastructure（Terraform）
- SNS Topic
- SQS Queues（含 Dead Letter Queue）
- API Gateway + Lambda（各 Connector）
- 一鍵部署

### 進階功能（Phase 2）

- Routing Rules UI（依來源 / keyword / tag 路由到不同 queue）
- Audit Log（完整的 event → agent → reply trace）
- Rate Limiting（每個 Agent 的 quota 管理）
- Python SDK
- 對話狀態管理（thread_ts ↔ session_id 對應，存 DynamoDB）

---

## 非功能需求

- **可靠性**：事件不遺失（SQS at-least-once + DLQ）
- **可擴展性**：加新 Connector 不影響現有 Agent
- **可觀測性**：每個事件都有完整的 lifecycle trace
- **安全性**：IAM 最小權限，各 Connector 獨立驗證機制
- **開源**：MIT License，任何人可以自行部署

---

## 技術決策

| 元件 | 技術選擇 | 理由 |
|------|---------|------|
| 後端 | Node.js + Fastify | 輕量、async 友善 |
| 前端 | Vue.js | 團隊偏好 |
| 部署 | Terraform | 多 Cloud 支援、IaC 標準 |
| Broker | AWS SNS + SQS | 原生 HA、IAM 授權、at-least-once |
| Connector | AWS Lambda | 無伺服器、便宜、Slack 3秒限制友善 |
| 對話狀態 | DynamoDB | Serverless、低延遲 |

---

## 不在範圍內

- Agent 的執行邏輯（各 Agent 自行實作）
- LLM 的選擇（Agent 自己決定）
- Agent 之間的溝通（A2A / MCP 的範疇）
- Agent 的記憶體管理
