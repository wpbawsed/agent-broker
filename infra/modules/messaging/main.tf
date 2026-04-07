locals {
  prefix = "${var.project_name}-${var.environment}"
}

# SNS Topic — single entry point for all Connector events
resource "aws_sns_topic" "events" {
  name = "${local.prefix}-events"
}

# ─── QA Agent Queue ───────────────────────────────────────────────
resource "aws_sqs_queue" "qa_agent_dlq" {
  name                      = "${local.prefix}-qa-agent-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "qa_agent" {
  name                       = "${local.prefix}-qa-agent"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.qa_agent_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "qa_agent" {
  queue_url = aws_sqs_queue.qa_agent.id
  policy    = data.aws_iam_policy_document.sqs_allow_sns.json
}

resource "aws_sns_topic_subscription" "qa_agent" {
  topic_arn     = aws_sns_topic.events.arn
  protocol      = "sqs"
  endpoint      = aws_sqs_queue.qa_agent.arn
  filter_policy = jsonencode({ source = ["slack"] })
}

# ─── Task Agent Queue ─────────────────────────────────────────────
resource "aws_sqs_queue" "task_agent_dlq" {
  name                      = "${local.prefix}-task-agent-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "task_agent" {
  name                       = "${local.prefix}-task-agent"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.task_agent_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "task_agent" {
  queue_url = aws_sqs_queue.task_agent.id
  policy    = data.aws_iam_policy_document.sqs_allow_sns.json
}

resource "aws_sns_topic_subscription" "task_agent" {
  topic_arn     = aws_sns_topic.events.arn
  protocol      = "sqs"
  endpoint      = aws_sqs_queue.task_agent.arn
  filter_policy = jsonencode({ source = ["jira"] })
}

# ─── Notify Agent Queue ───────────────────────────────────────────
resource "aws_sqs_queue" "notify_agent_dlq" {
  name                      = "${local.prefix}-notify-agent-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "notify_agent" {
  name                       = "${local.prefix}-notify-agent"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notify_agent_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "notify_agent" {
  queue_url = aws_sqs_queue.notify_agent.id
  policy    = data.aws_iam_policy_document.sqs_allow_sns.json
}

resource "aws_sns_topic_subscription" "notify_agent" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.notify_agent.arn
  # No filter — receives all events for fan-out notifications
}

# ─── IAM: allow SNS to send to all SQS queues ────────────────────
data "aws_iam_policy_document" "sqs_allow_sns" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = ["arn:aws:sqs:*:*:${local.prefix}-*"]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.events.arn]
    }
  }
}
