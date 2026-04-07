/**
 * Verify the Jira Webhook request.
 * Jira appends a shared secret as a query string token.
 *
 * @param {object} lambdaEvent - Raw Lambda event (API Gateway v2 payload)
 * @returns {boolean}
 */
export const verifyJiraWebhook = (lambdaEvent) => {
  const secret =
    lambdaEvent.queryStringParameters?.token || lambdaEvent.headers?.['x-jira-webhook-token']
  return typeof secret === 'string' && secret === process.env.JIRA_WEBHOOK_SECRET
}
