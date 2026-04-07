import { AgentConsumer } from '@agent-broker/sdk'
import { setSlackReaction } from '@agent-broker/core'

const agent = new AgentConsumer({
  queueUrl: process.env.QUEUE_URL,
  agentId: 'devops-agent',
  region: process.env.AWS_REGION || 'ap-northeast-1',
  concurrency: 1,
  healthPort: parseInt(process.env.HEALTH_PORT || '3001', 10),
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:4000',
  replyOptions: {
    slackToken: process.env.SLACK_BOT_TOKEN,
  },
})

agent.on('message', async (event, ctx) => {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[1/5] 📨 收到事件: ${event.event_id}`)
  console.log(`      source   : ${event.source}`)
  console.log(`      text     : ${event.text}`)
  console.log(`      channel  : ${event.source_meta?.channel_id}`)
  console.log(`      thread_ts: ${event.source_meta?.thread_ts}`)
  console.log(`      reply_to : ${JSON.stringify(event.reply_to)}`)

  console.log(`[2/5] ⏱  延長 visibility timeout → 120s`)
  await ctx.extend(120)

  const replyText = `收到了：${event.text}`
  console.log(`[3/5] 💬 準備回覆: "${replyText}"`)

  try {
    await ctx.reply(replyText)
    console.log(`[4/5] ✅ 回覆成功`)

    if (event.source === 'slack' && event.source_meta?.channel_id && event.source_meta?.thread_ts) {
      console.log(`[4/5]    移除 ⏳ reaction...`)
      await setSlackReaction(
        'remove',
        event.source_meta.channel_id,
        event.source_meta.thread_ts,
        'hourglass_flowing_sand',
        { slackToken: process.env.SLACK_BOT_TOKEN },
      ).catch((e) => console.warn(`[4/5]    reaction remove 失敗: ${e.message}`))
    }
  } catch (err) {
    console.warn(`[4/5] ⚠️  回覆失敗: ${err.message}`)
  }

  await ctx.done()
  console.log(`[5/5] 🗑  SQS 訊息已刪除`)
  console.log(`${'─'.repeat(60)}\n`)
})

agent.on('error', (err, event) => {
  console.error(`[devops-agent] ❌ Error processing event ${event?.event_id}:`, err)
})

agent.start()
console.log('[devops-agent] 🚀 Started. Polling SQS for messages...')
console.log(`   QUEUE_URL  : ${process.env.QUEUE_URL}`)
console.log(`   AWS_REGION : ${process.env.AWS_REGION}`)
console.log(`   HEALTH_PORT: ${process.env.HEALTH_PORT}`)
console.log('')
