import type { ResidencyApi } from '@mod/residency/contracts'
import {
  INBOX_UNREAD_CAP,
  NOTIFICATION_TEMPLATES,
  type Params,
  type SourceKind,
  type TemplateKey,
} from '@rms/shared-types'
import type { InboxEntryRow } from '../../domain/inbox-entry'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'
import { decodeInboxCursor, encodeInboxCursor } from '../inbox-cursor'
import type { InboxReader } from '../inbox-reader'

/** One item of E-76 and E-78: the key and params, never rendered text (DOC-50 §11, DOC-31 §4.4). */
interface InboxItemDto {
  id: string
  templateKey: TemplateKey
  params: Params
  unitId: string | null
  source: { kind: SourceKind; id: string }
  /** Where a tap opens, computed from the catalog so the client navigates as a push tap does (DOC-31 §6.5). */
  target: { route: string; unitId: string | null; entityId: string | null }
  /** The path the web CMS bell opens; staff entries only (DOC-31 §3.2). */
  webPath?: string | null
  createdAt: string
  readAt: string | null
}

export interface InboxPageDto {
  items: InboxItemDto[]
  nextCursor: string | null
  /** Unread visible entries, capped at 100 on every page (DOC-31 §4.4). */
  unreadCount: number
}

const INBOX_PAGE_DEFAULT = 20
const INBOX_PAGE_MAX = 100

/** The reads of E-76 and E-78 (DOC-31 §4.4): the unit filter applies to a resident only (§4.2). */
export class InboxQueries {
  constructor(
    private readonly entries: InboxEntryRepository,
    private readonly residency: Pick<ResidencyApi, 'activeUnitIds'>,
  ) {}

  async list(
    reader: InboxReader,
    page: { cursor?: string; limit?: number },
  ): Promise<InboxPageDto> {
    const limit = Math.min(Math.max(page.limit ?? INBOX_PAGE_DEFAULT, 1), INBOX_PAGE_MAX)
    const after = page.cursor === undefined ? null : decodeInboxCursor(page.cursor)
    const account = { kind: reader.kind, id: reader.accountId }
    const activeUnitIds =
      reader.kind === 'resident' ? await this.residency.activeUnitIds(reader.accountId) : null
    const [rows, unreadCount] = await Promise.all([
      this.entries.list(reader.scope, account, activeUnitIds, after, limit),
      this.entries.countUnread(reader.scope, account, activeUnitIds, INBOX_UNREAD_CAP),
    ])
    return {
      items: rows.items.map((row) => toItem(row, reader.kind === 'staff')),
      nextCursor: rows.nextCursor === null ? null : encodeInboxCursor(rows.nextCursor),
      unreadCount,
    }
  }
}

function toItem(row: InboxEntryRow, staff: boolean): InboxItemDto {
  const def = NOTIFICATION_TEMPLATES[row.templateKey]
  const item: InboxItemDto = {
    id: row.id,
    templateKey: row.templateKey,
    params: row.params,
    unitId: row.unitId,
    source: { kind: row.sourceKind, id: row.sourceId },
    target: {
      route: def.target.route,
      unitId: row.unitId,
      entityId: def.target.entity === 'source' ? row.sourceId : null,
    },
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
  }
  if (staff) item.webPath = def.webPath === null ? null : def.webPath.replace('{id}', row.sourceId)
  return item
}
