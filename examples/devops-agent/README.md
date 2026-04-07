# DevOps Agent Example

A minimal example Agent using `@agent-broker/sdk`.

## Setup

```bash
pnpm install
```

## Run

```bash
export QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/<account>/agent-broker-prod-qa-agent"
export SLACK_BOT_TOKEN="xoxb-..."   # Required only if replying to Slack
export AWS_REGION="ap-northeast-1"

pnpm start
```

## What it does

1. Polls the QA-agent SQS queue for events
2. Logs the event text to stdout
3. Replies `"收到了：<text>"` to the source channel (Slack thread / Jira comment)
4. Marks the message as done (removes from queue)

## Extend with real DevOps logic

Replace the comment block in `src/index.js` with your actual logic:

```js
// Run kubectl
import { execSync } from 'child_process'
const logs = execSync(`kubectl logs deployment/${serviceName} --tail=50`).toString()
await ctx.reply(logs)
```
