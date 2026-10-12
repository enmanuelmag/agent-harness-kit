import { randomUUID } from 'node:crypto'

import { err, ok } from '../result.js'
import { NotificationLedger } from './ledger.js'
import { type PlayerOptions, playNotification } from './player.js'

import type { NotificationResult, NotificationSettings } from './types.js'

export async function deliverEvent(
  eventId: string,
  settings: NotificationSettings,
  path: string,
  playerOptions?: PlayerOptions
): Promise<NotificationResult<'played' | 'skipped'>> {
  if (!settings.enabled) return ok('skipped')
  let ledger: NotificationLedger | undefined
  try {
    ledger = new NotificationLedger(path, settings)
    const owner = randomUUID()
    const claimed = ledger.claimEvent(eventId, owner)
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok('skipped')
    const event = ledger.getEvent(eventId)
    if (!event.ok) return event
    if (!event.value) return ok('skipped')
    const result = await playNotification(event.value.kind, settings, playerOptions)
    const finished = ledger.finishEvent(eventId, owner, result.ok ? result.value : 'failed')
    if (!result.ok) return result
    if (!finished.ok) return finished
    if (!finished.value) return ok('skipped')
    return result
  } catch (cause) {
    return err({
      context: 'notification worker',
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    try {
      ledger?.close()
    } catch {
      /* advisory cleanup cannot affect callers */
    }
  }
}
