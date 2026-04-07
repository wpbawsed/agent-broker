output "sns_topic_arn" { value = aws_sns_topic.events.arn }
output "qa_agent_queue_url" { value = aws_sqs_queue.qa_agent.url }
output "task_agent_queue_url" { value = aws_sqs_queue.task_agent.url }
output "notify_agent_queue_url" { value = aws_sqs_queue.notify_agent.url }
output "qa_agent_queue_arn" { value = aws_sqs_queue.qa_agent.arn }
output "task_agent_queue_arn" { value = aws_sqs_queue.task_agent.arn }
output "notify_agent_queue_arn" { value = aws_sqs_queue.notify_agent.arn }
