import {
  IdParams,
  type RouteInfo,
  type RouteSet,
  residentRoute,
  routePlugin,
  unitRoute,
} from '@core/http'
import { type Guards, residentOf, unitOf } from '@rms/shared-types'
import type { Static } from '@sinclair/typebox'
import { residentReader } from '../application/inbox-reader'
import type { InboxQueries } from '../application/queries/inbox-queries'
import type { MarkInboxEntryRead } from '../application/use-cases/mark-inbox-entry-read'
import type { ReadAllInbox } from '../application/use-cases/read-all-inbox'
import type { RegisterDevice } from '../application/use-cases/register-device'
import type { RemoveDevice } from '../application/use-cases/remove-device'
import { InboxQuery, inboxPage, ReadAllBody, RegisterDeviceBody } from './inbox-http'

export interface ResidentNotificationRouteDeps {
  registerDevice: RegisterDevice
  removeDevice: RemoveDevice
  inboxQueries: InboxQueries
  readAllInbox: ReadAllInbox
  markInboxEntryRead: MarkInboxEntryRead
  guards: Guards
}

/**
 * The resident side of `notification` (DOC-31 §4.4, §5): the device endpoints are token-only routes (a device registers before
 * a unit is chosen, DOC-12 §5.3); the inbox endpoints need `personal_notifications`, which a helper lacks (UIRA-55).
 */
export function residentNotificationRoutes(d: ResidentNotificationRouteDeps) {
  const register = async (context: { body: Static<typeof RegisterDeviceBody>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    const session = residentOf(context)
    return d.registerDevice.execute(
      { kind: 'resident', accountId: session.accountId, sessionId: session.sessionId },
      context.body,
    )
  }
  const remove = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    const session = residentOf(context)
    await d.removeDevice.execute(
      { kind: 'resident', accountId: session.accountId },
      context.params.id,
    )
    context.set.status = 204
  }
  const list = async (context: { query: Static<typeof InboxQuery>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.inboxQueries.list(residentReader(unitOf(context)), inboxPage(context.query))
  }
  const readAll = async (context: { body: Static<typeof ReadAllBody>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.readAllInbox.execute(residentReader(unitOf(context)), context.body.upToId)
  }
  const readOne = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.markInboxEntryRead.execute(residentReader(unitOf(context)), context.params.id)
    context.set.status = 204
  }

  const device = (info: RouteInfo) => residentRoute(d.guards, 'notification', info)
  const inbox = (info: RouteInfo) =>
    unitRoute(d.guards, 'notification', 'personal_notifications', info)

  return routePlugin({ prefix: '/me' })
    .post('/devices', register, {
      ...device({
        endpoint: 'E-22',
        operationId: 'registerMyDevice',
        summary: 'Register my push token',
        description:
          'Registers the Expo push token of this device for the calling session. An upsert on the token: the same token again returns the same id, and a token registered by another account moves to this session.',
      }),
      body: RegisterDeviceBody,
    })
    .delete('/devices/:id', remove, {
      ...device({
        endpoint: 'E-23',
        operationId: 'removeMyDevice',
        summary: 'Remove my push token',
        description:
          'Removes this device token. Answers 204 also when the id is unknown or belongs to another account; nothing is revealed.',
      }),
      params: IdParams,
    })
    .get('/inbox', list, {
      ...inbox({
        endpoint: 'E-78',
        operationId: 'listMyInbox',
        summary: 'List my inbox',
        description:
          'The entries of the resident in every unit they hold, newest first, with the unread count (capped at 100). Entries carry the template key and params; the app renders the text.',
      }),
      query: InboxQuery,
    })
    .post('/inbox/read-all', readAll, {
      ...inbox({
        endpoint: 'E-79',
        operationId: 'readAllMyInbox',
        summary: 'Mark my inbox read',
        description:
          'Marks every unread entry up to `upToId` read. A newer entry stays unread; a second call changes nothing.',
      }),
      body: ReadAllBody,
    })
    .post('/inbox/:id/read', readOne, {
      ...inbox({
        endpoint: 'E-178',
        operationId: 'readMyInboxEntry',
        summary: 'Mark one inbox entry read',
        description:
          "Sets the read time of one entry. A notice entry is left to the notice read. Answers 404 for an unknown id, another account's entry or an entry of a unit the resident no longer holds.",
      }),
      params: IdParams,
    })
}
