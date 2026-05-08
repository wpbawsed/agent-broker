import { z } from 'zod'
import { randomUUID } from 'crypto'

export const BrokerEventSchema = z.object({
  event_id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.enum(['slack', 'jira', 'github', 'webhook', 'agent']),
  source_meta: z.object({
    channel_id: z.string().optional(),
    thread_ts: z.string().optional(),
    user_id: z.string().optional(),
    issue_key: z.string().optional(),
    issue_type: z.string().optional(),
    project_key: z.string().optional(),
    raw: z.record(z.unknown()).optional(),
  }),
  text: z.string().min(1),
  attachments: z
    .array(
      z.object({
        type: z.enum(['file', 'image', 'url']),
        url: z.string().url(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  reply_to: z.object({
    channel: z.string(),
    thread_ts: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  requested_by: z.string(),
  tenant_id: z.string().default('default'),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  ttl: z.number().int().positive().default(3600),
})

/**
 * Validate a raw object against BrokerEventSchema.
 * Returns { success, data, error }.
 */
export const validateEvent = (raw) => {
  return BrokerEventSchema.safeParse(raw)
}

/**
 * Create a new BrokerEvent with required fields filled in.
 * Callers must supply: source, source_meta, text, reply_to, requested_by
 */
export const createEvent = (fields) => {
  const raw = {
    event_id: randomUUID(),
    created_at: new Date().toISOString(),
    priority: 'normal',
    ttl: 3600,
    ...fields,
  }
  const result = BrokerEventSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid BrokerEvent: ${result.error.message}`)
  }
  return result.data
}
