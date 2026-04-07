locals {
  prefix        = "${var.project_name}-${var.environment}"
  function_name = "${local.prefix}-connector-${var.connector_name}"
}

# ─── Lambda Execution Role ────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "sns_publish" {
  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [var.sns_topic_arn]
  }
}

resource "aws_iam_role_policy" "sns_publish" {
  name   = "sns-publish"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.sns_publish.json
}

# ─── Lambda Function ──────────────────────────────────────────────
resource "aws_lambda_function" "connector" {
  function_name = local.function_name
  role          = aws_iam_role.lambda.arn
  filename      = var.lambda_zip_path
  handler       = var.lambda_handler
  runtime       = "nodejs22.x"
  timeout       = 30
  memory_size   = 256

  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = var.environment_variables
  }

  depends_on = [aws_iam_role_policy_attachment.basic_execution]
}

resource "aws_cloudwatch_log_group" "connector" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 30
}

# ─── API Gateway v2 (HTTP API) ────────────────────────────────────
resource "aws_apigatewayv2_api" "connector" {
  name          = "${local.function_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "connector" {
  api_id                 = aws_apigatewayv2_api.connector.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.connector.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "connector" {
  api_id    = aws_apigatewayv2_api.connector.id
  route_key = "POST /${var.connector_name}"
  target    = "integrations/${aws_apigatewayv2_integration.connector.id}"
}

resource "aws_apigatewayv2_stage" "connector" {
  api_id      = aws_apigatewayv2_api.connector.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.connector.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.connector.execution_arn}/*/*"
}
