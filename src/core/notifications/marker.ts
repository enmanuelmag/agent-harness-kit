import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'

import type { NotificationEvent } from './types'
import type { CallToolResult } from '@modelcontextprotocol/server'

const eventSchema = z
  .object({
    eventId: z.string().uuid(),
    kind: z.enum(['task.completed', 'health.blocked', 'provider.completed', 'attention.requested']),
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    delivery: z.enum(['pending', 'playing', 'played', 'failed', 'skipped']),
  })
  .strict()
const markerSchema = z
  .object({ notificationSchemaVersion: z.literal(1), events: z.array(eventSchema).max(8) })
  .strict()
export type NotificationMarkerEvent = z.infer<typeof eventSchema>
const collector = new AsyncLocalStorage<NotificationMarkerEvent[]>()
export function recordNotificationEvent(event: NotificationEvent): void {
  const events = collector.getStore()
  if (!events || events.length >= 8 || events.some((item) => item.eventId === event.id)) return
  events.push({
    eventId: event.id,
    kind: event.kind,
    projectKey: event.projectKey,
    delivery: event.status,
  })
}
export async function captureNotificationEvents<T>(
  operation: () => Promise<T>
): Promise<{ result: T; events: NotificationMarkerEvent[] }> {
  const events: NotificationMarkerEvent[] = []
  const result = await collector.run(events, operation)
  return { result, events }
}
export function appendNotificationMarker(
  result: CallToolResult,
  events: NotificationMarkerEvent[]
): CallToolResult {
  if (!events.length) return result
  try {
    return {
      ...result,
      content: [
        ...result.content,
        {
          type: 'text',
          text: JSON.stringify(markerSchema.parse({ notificationSchemaVersion: 1, events })),
        },
      ],
    }
  } catch {
    return result
  }
}
/** Only full JSON text blocks within a structured tool result; never assistant prose/substrings. */
export function readNotificationMarkers(response: unknown): NotificationMarkerEvent[] {
  if (
    !response ||
    typeof response !== 'object' ||
    !Array.isArray((response as { content?: unknown }).content)
  )
    return []
  const items = (response as { content: unknown[] }).content.slice(0, 32)
  const events: NotificationMarkerEvent[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'text') continue
    const text = (item as { text?: unknown }).text
    if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) continue
    try {
      const marker = markerSchema.safeParse(JSON.parse(text))
      if (marker.success) events.push(...marker.data.events)
    } catch {
      /* untrusted non-marker */
    }
  }
  return events.slice(0, 8)
}
