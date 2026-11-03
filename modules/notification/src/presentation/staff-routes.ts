import { IdParams, type RouteInfo, type RouteSet, routePlugin, staffRoute } from '@core/http'
import { type Guards, STAFF_ROLES, staffOf } from '@rms/shared-types'
import type { Static } from '@sinclair/typebox'
import { staffReader } from '../application/inbox-reader'
import type { InboxQueries } from '../application/queries/inbox-queries'
import type { MarkInboxEntryRead } from '../application/use-cases/mark-inbox-entry-read'
import type { ReadAllInbox } from '../application/use-cases/read-all-inbox'
import type { RegisterDevice } from '../application/use-cases/register-device'
import type { RemoveDevice } from '../application/use-cases/remove-device'
import { InboxQuery, inboxPage, ReadAllBody, RegisterDeviceBody } from './inbox-http'

export interface StaffNotificationRouteDeps {
  registerDevice: RegisterDevice
  removeDevice: RemoveDevice
  inboxQueries: InboxQueries
  readAllInbox: ReadAllInbox
  markInboxEntryRead: MarkInboxEntryRead
  guards: Guards
}

/** The staff side of `notification` (DOC-31 §4.4, §5): every staff role has a device list and an inbox. */
export function staffNotificationRoutes(d: StaffNotificationRouteDeps) {
  const register = async (context: { body: Static<typeof RegisterDeviceBody>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    const staff = staffOf(context)
    return d.registerDevice.execute(
      { kind: 'staff', accountId: staff.staffId, sessionId: staff.sessionId },
      context.body,
    )
  }
  const remove = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.removeDevice.execute(
      { kind: 'staff', accountId: staffOf(context).staffId },
      context.params.id,
    )
    context.set.status = 204
  }
  const list = async (context: { query: Static<typeof InboxQuery>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.inboxQueries.list(staffReader(staffOf(context)), inboxPage(context.query))
  }
  const readAll = async (context: { body: Static<typeof ReadAllBody>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.readAllInbox.execute(staffReader(staffOf(context)), context.body.upToId)
  }
  const readOne = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.markInboxEntryRead.execute(staffReader(staffOf(context)), context.params.id)
    context.set.status = 204
  }

  const route = (info: RouteInfo) => staffRoute(d.guards, 'notification', STAFF_ROLES, info)

  return routePlugin({ prefix: '/staff' })
    .post('/devices', register, {
      ...route({
        endpoint: 'E-34',
        operationId: 'registerStaffDevice',
        summary: 'Register my push token',
        description:
          'Registers the Expo push token of the staff app for the calling session. An upsert on the token: the same token again returns the same id.',
      }),
      body: RegisterDeviceBody,
    })
    .delete('/devices/:id', remove, {
      ...route({
        endpoint: 'E-35',
        operationId: 'removeStaffDevice',
        summary: 'Remove my push token',
        description:
          'Removes this device token. Answers 204 also when the id is unknown or belongs to another account; nothing is revealed.',
      }),
      params: IdParams,
    })
    .get('/inbox', list, {
      ...route({
        endpoint: 'E-76',
        operationId: 'listStaffInbox',
        summary: 'List my inbox',
        description:
          'The inbox of the signed-in staff member, newest first, with the unread count (capped at 100). Entries carry the template key, params, the app route and the web path.',
      }),
      query: InboxQuery,
    })
    .post('/inbox/read-all', readAll, {
      ...route({
        endpoint: 'E-77',
        operationId: 'readAllStaffInbox',
        summary: 'Mark my inbox read',
        description:
          'Marks every unread entry up to `upToId` read. A newer entry stays unread; a second call changes nothing.',
      }),
      body: ReadAllBody,
    })
    .post('/inbox/:id/read', readOne, {
      ...route({
        endpoint: 'E-179',
        operationId: 'readStaffInboxEntry',
        summary: 'Mark one inbox entry read',
        description:
          "Sets the read time of one entry. Answers 404 for an unknown id or another account's entry.",
      }),
      params: IdParams,
    })
}
