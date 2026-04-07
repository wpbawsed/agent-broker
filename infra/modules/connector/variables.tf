variable "project_name" { type = string }
variable "environment" { type = string }
variable "connector_name" { type = string }
variable "lambda_handler" { type = string }
variable "lambda_zip_path" { type = string }
variable "sns_topic_arn" { type = string }
variable "environment_variables" { type = map(string) }
