import type { RealtimeEventType } from '../contracts'

/** `YYYY-MM-DDTHH:mm:ss.SSSZ` (DOC-50 §6). */
export const instant = (date: Date): string => date.toISOString()

/** The first frame of every stream (DOC-52 §5). */
export const readyFrame = (ready: { cursor: string; sessionId: string; resumed: boolean }) =>
  `event: ready\ndata: ${JSON.stringify(ready)}\n\n`

/** An event frame: `id`, `event` and a one-line JSON `data` with `id`, `type`, `data`, `at` (DOC-52 §5). */
export const eventFrame = (event: {
  id: string
  type: RealtimeEventType
  data: Record<string, unknown>
  at: string
}) =>
  `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ id: event.id, type: event.type, data: event.data, at: event.at })}\n\n`

/** A comment frame: the client's parser skips it, the bytes keep Cloudflare from closing a silent request (DOC-52 §5). */
export const heartbeatFrame = (): string => ': hb\n\n'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** `Last-Event-ID` is client input: only a UUIDv7 counts, anything else is ignored, never refused (DOC-52 §4). */
export function parseLastEventId(raw: string | null | undefined): string | undefined {
  return raw && UUID_V7.test(raw) ? raw.toLowerCase() : undefined
}

/** The time a UUIDv7 was minted: its first 48 bits, in milliseconds. */
function uuidV7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}

const REPLAY_WINDOW_MS = 23 * 3_600_000
export const REPLAY_LIMIT = 200

/** Replay only when the id is no older than 23 hours, one hour below the retention (DOC-52 §8.2 step 4). */
export const canReplay = (lastEventId: string, now: Date): boolean =>
  now.getTime() - uuidV7Time(lastEventId) <= REPLAY_WINDOW_MS
