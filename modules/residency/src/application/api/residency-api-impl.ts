import type { ResidencyApi } from '../../contracts'
import type { MembershipQueries } from '../queries/membership-queries'

/** The contract of DOC-27 §2.1: reads go to the query service, and there is no rule of its own here (DOC-12 §4.5 rule 3). */
export class ResidencyApiImpl implements ResidencyApi {
  constructor(private readonly queries: MembershipQueries) {}

  getMembership: ResidencyApi['getMembership'] = (accountId, unitId) =>
    this.queries.membership(accountId, unitId)
  listRecipients: ResidencyApi['listRecipients'] = (unitId, capability, page) =>
    this.queries.recipients(unitId, capability, page)
  listNoticeRecipients: ResidencyApi['listNoticeRecipients'] = (buildingId, cursor, limit) =>
    this.queries.noticeRecipients(buildingId, cursor, limit)
  activeUnitIds: ResidencyApi['activeUnitIds'] = (accountId) =>
    this.queries.activeUnitIds(accountId)
  getUnits: ResidencyApi['getUnits'] = (ids) => this.queries.units(ids)
  getMembershipForScan: ResidencyApi['getMembershipForScan'] = (membershipId) =>
    this.queries.forScan(membershipId)
  ownedUnitIds: ResidencyApi['ownedUnitIds'] = (accountId) => this.queries.ownedUnitIds(accountId)
  listActiveMemberships: ResidencyApi['listActiveMemberships'] = (accountId) =>
    this.queries.listActive(accountId)
  buildingIdsOfAccounts: ResidencyApi['buildingIdsOfAccounts'] = (accountIds) =>
    this.queries.buildingIdsOfAccounts(accountIds)
}
