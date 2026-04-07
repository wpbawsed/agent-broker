import crypto from 'crypto'

/**
 * Verify the Slack request signature.
 *
 * @param {object} lambdaEvent  - Raw Lambda event (API Gateway v2 payload)
 * @returns {boolean}
 */
export const verifySlackSignature = (lambdaEvent) => {
  const timestamp = lambdaEvent.headers?.['x-slack-request-timestamp']
  const signature = lambdaEvent.headers?.['x-slack-signature']
  const rawBody = lambdaEvent.body

  if (!timestamp || !signature || !rawBody) return false

  // Prevent replay attacks — reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false

  const sigBase = `v0:${timestamp}:${rawBody}`
  const hmac = crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest('hex')

  const expected = Buffer.from(`v0=${hmac}`)
  const received = Buffer.from(signature)

  // Lengths must match before timingSafeEqual
  if (expected.length !== received.length) return false

  return crypto.timingSafeEqual(expected, received)
}
