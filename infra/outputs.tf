output "slack_webhook_url" {
  value       = module.connector_slack.api_endpoint
  description = "Paste this URL into Slack App → Event Subscriptions → Request URL"
}

output "jira_webhook_url" {
  value       = module.connector_jira.api_endpoint
  description = "Paste this URL into Jira → System → Webhooks"
}

output "qa_agent_queue_url" {
  value       = module.messaging.qa_agent_queue_url
  description = "SQS URL for question-answering Agents"
}

output "task_agent_queue_url" {
  value       = module.messaging.task_agent_queue_url
  description = "SQS URL for task-execution Agents"
}

output "notify_agent_queue_url" {
  value       = module.messaging.notify_agent_queue_url
  description = "SQS URL for notification Agents"
}

output "conversations_table_name" {
  value       = module.storage.table_name
  description = "DynamoDB table for conversation state"
}
