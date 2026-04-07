terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "messaging" {
  source       = "./modules/messaging"
  project_name = var.project_name
  environment  = var.environment
}

module "storage" {
  source       = "./modules/storage"
  project_name = var.project_name
  environment  = var.environment
}

module "connector_slack" {
  source          = "./modules/connector"
  project_name    = var.project_name
  environment     = var.environment
  connector_name  = "slack"
  lambda_handler  = "index.handler"
  lambda_zip_path = "${path.module}/../connectors/slack/dist/function.zip"
  sns_topic_arn   = module.messaging.sns_topic_arn

  environment_variables = {
    SLACK_SIGNING_SECRET                = var.slack_signing_secret
    SLACK_BOT_TOKEN                     = var.slack_bot_token
    SNS_TOPIC_ARN                       = module.messaging.sns_topic_arn
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  }
}

module "connector_jira" {
  source          = "./modules/connector"
  project_name    = var.project_name
  environment     = var.environment
  connector_name  = "jira"
  lambda_handler  = "index.handler"
  lambda_zip_path = "${path.module}/../connectors/jira/dist/function.zip"
  sns_topic_arn   = module.messaging.sns_topic_arn

  environment_variables = {
    JIRA_WEBHOOK_SECRET                 = var.jira_webhook_secret
    SNS_TOPIC_ARN                       = module.messaging.sns_topic_arn
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  }
}
