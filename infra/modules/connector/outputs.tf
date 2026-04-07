output "api_endpoint" { value = aws_apigatewayv2_stage.connector.invoke_url }
output "lambda_arn" { value = aws_lambda_function.connector.arn }
output "lambda_name" { value = aws_lambda_function.connector.function_name }
