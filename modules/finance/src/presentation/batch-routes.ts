import {
  describedEnum,
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { type Guards, type LocalDate, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import { CLOSE_FEE_BATCH_ROLES, type CloseFeeBatch } from '../application/use-cases/close-fee-batch'
import {
  CREATE_FEE_BATCH_ROLES,
  type CreateFeeBatch,
} from '../application/use-cases/create-fee-batch'
import {
  DISCARD_FEE_BATCH_ROLES,
  type DiscardFeeBatch,
} from '../application/use-cases/discard-fee-batch'
import {
  PUBLISH_FEE_BATCH_ROLES,
  type PublishFeeBatch,
} from '../application/use-cases/publish-fee-batch'
import {
  RECALL_FEE_BATCH_ROLES,
  type RecallFeeBatch,
} from '../application/use-cases/recall-fee-batch'
import {
  REISSUE_FEE_BATCH_ROLES,
  type ReissueFeeBatch,
} from '../application/use-cases/reissue-fee-batch'
import {
  REQUEST_FEE_NOTICE_ZIP_ROLES,
  type RequestFeeNoticeZip,
} from '../application/use-cases/request-fee-notice-zip'
import {
  UPDATE_FEE_BATCH_ROLES,
  type UpdateFeeBatch,
} from '../application/use-cases/update-fee-batch'
import { batchBody, noticeJobBody } from './bodies'
import { quoted, staffAccount, versionOf } from './http'

export interface BatchRouteDeps {
  createFeeBatch: CreateFeeBatch
  updateFeeBatch: UpdateFeeBatch
  discardFeeBatch: DiscardFeeBatch
  publishFeeBatch: PublishFeeBatch
  recallFeeBatch: RecallFeeBatch
  closeFeeBatch: CloseFeeBatch
  reissueFeeBatch: ReissueFeeBatch
  requestFeeNoticeZip: RequestFeeNoticeZip
  guards: Guards
  idempotent: Idempotent
}

const Day = (description: string) => Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description })
const BatchName = Type.Object(
  {
    vi: Type.String({ maxLength: 200, description: 'The Vietnamese name, required' }),
    en: Type.Optional(Type.String({ maxLength: 200, description: 'The English name' })),
  },
  { additionalProperties: false, description: 'The name of the batch in both languages' },
)
const CreateBody = strictObject(
  {
    name: BatchName,
    feeMonth: Day(
      'The fee month: the first day of the month, `YYYY-MM-01`. It cannot be changed later',
    ),
    dueDate: Day(
      "The due date, `YYYY-MM-DD`; it is checked against the building's today at publish",
    ),
  },
  { description: 'The draft batch to create (DOC-21 §3.1)' },
)
const UpdateBody = strictObject(
  {
    name: Type.Optional(BatchName),
    dueDate: Type.Optional(Day('A new due date. After publish it can only move later')),
  },
  { description: 'The fields to change (DOC-21 §3.2, §3.4)' },
)
const ReasonBody = strictObject(
  { reason: Type.String({ maxLength: 1000, description: 'Why, 5 to 500 characters' }) },
  { description: 'The reason of the recall (DOC-21 §3.5)' },
)
const ReissueBody = strictObject(
  {
    dueDate: Type.Optional(Day("The due date of the new draft; the recalled batch's when absent")),
  },
  { description: 'The re-issue options (DOC-21 §3.7)' },
)
const PdfBody = strictObject(
  {
    language: Type.Optional(
      describedEnum({ vi: 'Vietnamese', en: 'English', both: 'Both languages on one notice' }),
    ),
  },
  { description: "The language of the notices; the building's default when absent (DOC-34 §9.1)" },
)

/** The batch routes that write (E-90, E-92, E-95…E-99, E-172); the reads are in `batch-read-routes.ts` (P2-15). */
export function batchRoutes(d: BatchRouteDeps) {
  const version = (context: { request: Request }) =>
    versionOf(context.request.headers.get('if-match'))
  const answer = (set: RouteSet, batch: Parameters<typeof batchBody>[0]) => {
    set.headers.etag = quoted(batch.version)
    return batchBody(batch)
  }

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const batch = await d.createFeeBatch.execute(staffOf(context), {
      name: context.body.name,
      feeMonth: context.body.feeMonth as LocalDate,
      dueDate: context.body.dueDate as LocalDate,
    })
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/fee-batches/${batch.id}`
    return answer(context.set, batch)
  }

  const update = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof UpdateBody>
    request: Request
    set: RouteSet
  }) =>
    answer(
      context.set,
      await d.updateFeeBatch.execute(staffOf(context), context.params.id, {
        name: context.body.name,
        dueDate: context.body.dueDate as LocalDate | undefined,
        version: version(context),
      }),
    )

  const publish = async (context: {
    params: Static<typeof IdParams>
    request: Request
    set: RouteSet
  }) =>
    answer(
      context.set,
      await d.publishFeeBatch.execute(staffOf(context), context.params.id, version(context)),
    )

  const recall = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof ReasonBody>
    request: Request
    set: RouteSet
  }) => {
    const out = await d.recallFeeBatch.execute(staffOf(context), context.params.id, {
      reason: context.body.reason,
      version: version(context),
    })
    return { ...answer(context.set, out.batch), chargeCount: out.chargeCount }
  }

  const close = async (context: {
    params: Static<typeof IdParams>
    request: Request
    set: RouteSet
  }) =>
    answer(
      context.set,
      await d.closeFeeBatch.execute(staffOf(context), context.params.id, version(context)),
    )

  const reissue = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof ReissueBody>
    set: RouteSet
  }) => {
    const out = await d.reissueFeeBatch.execute(staffOf(context), context.params.id, {
      dueDate: context.body.dueDate as LocalDate | undefined,
    })
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/fee-batches/${out.batch.id}`
    context.set.headers.etag = quoted(out.batch.version)
    return { batchId: out.batch.id, code: out.batch.code, copiedCharges: out.chargeCount }
  }

  const discard = async (context: {
    params: Static<typeof IdParams>
    request: Request
    set: RouteSet
  }) => {
    await d.discardFeeBatch.execute(staffOf(context), context.params.id, version(context))
    context.set.status = 204
  }

  const requestPdf = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof PdfBody>
    set: RouteSet
  }) => {
    const out = await d.requestFeeNoticeZip.execute(staffOf(context), context.params.id, {
      language: context.body.language,
    })
    context.set.status = 202
    return noticeJobBody({ ...out.job, zip: null })
  }

  return routePlugin({ prefix: '/staff/fee-batches' })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'finance', CREATE_FEE_BATCH_ROLES, {
        endpoint: 'E-90',
        operationId: 'createFeeBatch',
        summary: 'Create a draft fee batch',
        description:
          'Creates an empty draft batch for one fee month and gives it the next code `PH-YYMM-NN`. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .patch('/:id', update, {
      ...staffRoute(d.guards, 'finance', UPDATE_FEE_BATCH_ROLES, {
        endpoint: 'E-92',
        operationId: 'updateFeeBatch',
        summary: 'Edit a fee batch',
        description:
          'A draft takes a new name or due date; a published batch takes only a later due date. Needs `If-Match` with the batch version.',
      }),
      params: IdParams,
      body: UpdateBody,
    })
    .post('/:id/publish', publish, {
      ...staffRoute(d.guards, 'finance', PUBLISH_FEE_BATCH_ROLES, {
        endpoint: 'E-95',
        operationId: 'publishFeeBatch',
        summary: 'Publish a draft batch',
        description:
          'Makes every charge of the draft payable at once and tells the residents. Needs `If-Match` with the batch version.',
      }),
      params: IdParams,
    })
    .post('/:id/recall', recall, {
      ...staffRoute(d.guards, 'finance', RECALL_FEE_BATCH_ROLES, {
        endpoint: 'E-96',
        operationId: 'recallFeeBatch',
        summary: 'Recall a published batch',
        description:
          'Voids every charge of the batch when none is paid (409 `batch_has_payments` otherwise) and cancels the payment links that hold them. Needs `If-Match` and a reason.',
      }),
      params: IdParams,
      body: ReasonBody,
    })
    .post('/:id/close', close, {
      ...staffRoute(d.guards, 'finance', CLOSE_FEE_BATCH_ROLES, {
        endpoint: 'E-97',
        operationId: 'closeFeeBatch',
        summary: 'Close a published batch',
        description:
          'Marks a published batch closed. Its open charges stay payable. Needs `If-Match`.',
      }),
      params: IdParams,
    })
    .post('/:id/reissue', reissue, {
      ...staffRoute(d.guards, 'finance', REISSUE_FEE_BATCH_ROLES, {
        endpoint: 'E-98',
        operationId: 'reissueFeeBatch',
        summary: 'Re-issue a recalled batch as a new draft',
        description:
          'Copies the charges and lines of a recalled batch, except the charges voided alone, into a new draft with a new code and `replacesBatchId`.',
      }),
      params: IdParams,
      body: ReissueBody,
    })
    .post('/:id/pdf', requestPdf, {
      ...staffRoute(d.guards, 'finance', REQUEST_FEE_NOTICE_ZIP_ROLES, {
        endpoint: 'E-99',
        operationId: 'requestBatchPdf',
        summary: 'Request the fee notices of a batch as a ZIP',
        description:
          'Starts the bulk job of a published or closed batch and answers 202 with the job. A repeat while one is queued or running answers that job (DOC-34 §9.1).',
      }),
      params: IdParams,
      body: PdfBody,
    })
    .delete('/:id', discard, {
      ...staffRoute(d.guards, 'finance', DISCARD_FEE_BATCH_ROLES, {
        endpoint: 'E-172',
        operationId: 'discardFeeBatch',
        summary: 'Discard a draft batch',
        description:
          'Deletes a draft with its charges. Its code is not issued again. Needs `If-Match`.',
      }),
      params: IdParams,
    })
}
