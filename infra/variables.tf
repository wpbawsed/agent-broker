variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "agent-broker"
}

variable "environment" {
  description = "Deployment environment (prod / dev)"
  type        = string
  default     = "prod"
}

variable "slack_signing_secret" {
  description = "Slack App Signing Secret (from Slack App settings)"
  type        = string
  sensitive   = true
}

variable "jira_webhook_secret" {
  description = "Secret token appended to Jira Webhook URL"
  type        = string
  sensitive   = true
}

variable "slack_bot_token" {
  description = "Slack Bot Token (xoxb-...) from OAuth & Permissions after app install"
  type        = string
  sensitive   = true
  default     = ""
}
