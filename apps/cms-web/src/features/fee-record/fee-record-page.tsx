import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { useSetBreadcrumbTail } from '../../components/layout/breadcrumb'
import { Button, buttonStyles } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/controls'
import { useLastDefined } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { RowMenu } from '../../components/ui/menu'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, Tag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { downloadFile } from '../../lib/download'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { ChargeVoidDialog, type VoidTarget } from '../charge-void/charge-void-dialog'
import { receiptPdfPath, type UnitDebt, unitDebtQuery, useDebtMutations } from '../debts/hooks'
import { PaymentDialog } from './payment-dialog'
import { VoidPaymentDialog } from './void-payment-dialog'

/** DOC-66 `W-Fee-Record`: a unit's debt; `dialog` and `charge`/`payment` are kept in the URL, `payments` is the receipt-history cursor. */
export interface FeeRecordSearch {
  dialog?: 'payment' | 'void-payment' | 'void'
  charge?: string
  payment?: string
  payments?: string
}

type Debt = UnitDebt
type Payment = Debt['payments'][number]

const bilingual = (name: { vi: string; en?: string }, lang: string) =>
  lang === 'en' ? (name.en ?? name.vi) : name.vi

/** The tone of an open charge by its age (DOC-66 §4, FR-12.1): a charge due today is not overdue and reads "Due today". */
function ChargeTag({ daysPastDue }: { daysPastDue: number }): ReactElement {
  const { t } = useI18n()
  if (daysPastDue > 0)
    return <Tag tone="danger">{t('status.charge-staff.overdue_days', { count: daysPastDue })}</Tag>
  if (daysPastDue === 0) return <Tag tone="warning">{t('web.fee-record.open.due-today')}</Tag>
  if (daysPastDue >= -7) return <Tag tone="warning">{t('status.charge-staff.due_soon')}</Tag>
  return <Tag tone="neutral">{t('status.charge-staff.unpaid')}</Tag>
}

/** `W-Fee-Record` (DOC-66): one unit's open charges, its manual payment, its receipts and its reminder. */
export function FeeRecordPage({
  unitId,
  search,
}: {
  unitId: string
  search: FeeRecordSearch
}): ReactElement | null {
  const { t, lang, formatDate, formatDateTime, formatMoney, formatPhone } = useI18n()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()
  const canWrite = useCanWrite()
  const query = useQuery(unitDebtQuery(unitId))
  const me = useQuery(staffMeQuery())
  const [selected, setSelected] = useState<string[]>([])
  const debt = query.data
  const openCharges = debt?.openCharges ?? []
  useSetBreadcrumbTail(debt?.unit.code ?? null)

  const go = (patch: Partial<FeeRecordSearch>, resetScroll = true) =>
    void navigate({
      to: '/debts/$unitId',
      params: { unitId },
      search: { ...search, ...patch },
      replace: true,
      resetScroll,
    })
  const openDialog = (patch: Partial<FeeRecordSearch>) =>
    void navigate({
      to: '/debts/$unitId',
      params: { unitId },
      search: { ...search, ...patch },
      state: OPENED_HERE,
      resetScroll: false,
    })
  const closeDialog = (patch: Partial<FeeRecordSearch> = {}) =>
    closeOverlay(() => go({ dialog: undefined, ...patch }, false))

  const voidCharge = useLastDefined(openCharges.find((charge) => charge.chargeId === search.charge))
  const voidPayment = useLastDefined(
    debt?.payments.find((payment) => payment.paymentId === search.payment),
  )
  const voidTarget: VoidTarget | undefined =
    voidCharge && debt
      ? {
          chargeId: voidCharge.chargeId,
          version: voidCharge.version,
          unitCode: debt.unit.code,
          amount: voidCharge.amount,
          batchCode: voidCharge.batch.code,
          unitId,
          hasActiveIntent: voidCharge.activeIntent !== null,
        }
      : undefined

  const viewReceipt = (receiptId: string, number: string) =>
    void downloadFile(receiptPdfPath(receiptId), `${number}.pdf`).catch(() =>
      toast.error(t('common.error.page.body')),
    )

  if (!debt && query.isError) {
    const failure = apiErrorOf(query.error)
    if (failure.status === 404)
      return (
        <EmptyState
          icon="magnifying-glass"
          title={t('common.not-found.title')}
          body={t('common.not-found.body')}
          actions={
            <Link to="/debts" search={{}} className={buttonStyles({ variant: 'outline' })}>
              {t('web.shell.nav.debts')}
            </Link>
          }
        />
      )
    return <ErrorState requestId={failure.requestId} onRetry={() => void query.refetch()} />
  }
  if (!debt) return <RecordSkeleton />

  const summary = debt.summary
  const daysLeft =
    openCharges.length === 0 ? 0 : -Math.max(...openCharges.map((charge) => charge.daysPastDue))

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Plate size="lg">{debt.unit.code}</Plate>
          <div className="min-w-0">
            <h1 className="text-title-1 text-ink">{t('web.fee-record.title')}</h1>
            {debt.owner.name && (
              <p className="mt-1 text-secondary text-ink-muted">
                {debt.owner.phone
                  ? t('web.fee-record.owner', {
                      name: debt.owner.name,
                      phone: formatPhone(debt.owner.phone),
                    })
                  : t('web.fee-record.owner.name', { name: debt.owner.name })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SendReminderButton unitId={unitId} canWrite={canWrite} />
          <Button
            data-testid="record-payment"
            disabled={!canWrite || openCharges.length === 0}
            onClick={() => openDialog({ dialog: 'payment' })}
          >
            {t('web.fee-record.action.pay')}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-display text-ink tabular-nums" data-testid="tile-outstanding">
            {formatMoney(summary.outstanding)}
          </p>
          <p className="mt-1 text-secondary text-ink-muted">
            {t('web.fee-record.tile.outstanding', { count: summary.openCharges })}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-display text-ink tabular-nums" data-testid="tile-nearest">
            {summary.nearestDue ? formatDate(summary.nearestDue) : '—'}
          </p>
          <p className="mt-1 text-secondary text-ink-muted">
            {t('web.fee-record.tile.nearest', { days: Math.max(0, daysLeft) })}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-display text-ink tabular-nums" data-testid="tile-overdue">
            {formatMoney(summary.overdueAmount)}
          </p>
          <p className="mt-1 text-secondary text-ink-muted">{t('web.fee-record.tile.overdue')}</p>
        </Card>
      </div>

      <section aria-labelledby="open-charges" className="mb-6">
        <h2 id="open-charges" className="mb-3 text-title-3 text-ink">
          {t('web.fee-record.open.title')}
        </h2>
        <DataTable
          label={t('web.fee-record.open.title')}
          minWidth="min-w-[960px]"
          busy={query.isPlaceholderData}
          footer={
            <>
              <span className="text-secondary text-ink-muted">
                {t('web.fee-record.open.total')}
              </span>
              <span className="text-body-strong text-ink tabular-nums">
                {formatMoney(summary.outstanding)}
              </span>
            </>
          }
        >
          <THead>
            <Tr>
              <Th className="w-10">
                <span className="sr-only">{t('web.fee-record.open.col.select')}</span>
              </Th>
              <Th className="w-32">{t('web.fee-record.open.col.batch')}</Th>
              <Th>{t('web.fee-record.open.col.name')}</Th>
              <Th className="w-36">{t('web.fee-record.open.col.due')}</Th>
              <Th className="w-32">{t('web.fee-record.open.col.status')}</Th>
              <Th className="w-32 text-right">{t('web.fee-record.open.col.amount')}</Th>
              <Th className="w-12">
                <span className="sr-only">{t('web.fee-record.open.col.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {openCharges.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="text-secondary text-ink-muted" data-testid="open-empty">
                  {t('web.fee-record.open.empty')}
                </Td>
              </Tr>
            ) : (
              openCharges.map((charge) => (
                <Tr key={charge.chargeId} data-testid="open-charge-row">
                  <Td>
                    <Checkbox
                      checked={selected.includes(charge.chargeId)}
                      onCheckedChange={(next) =>
                        setSelected((current) =>
                          next
                            ? [...current, charge.chargeId]
                            : current.filter((id) => id !== charge.chargeId),
                        )
                      }
                      label={<span className="sr-only">{t('web.fee-record.open.col.select')}</span>}
                    />
                  </Td>
                  <Td>
                    <Plate>{charge.batch.code}</Plate>
                  </Td>
                  <Td>
                    <p className="text-body-strong">{bilingual(charge.batch.name, lang)}</p>
                    {charge.activeIntent && (
                      <p className="mt-1 flex items-center gap-1 text-secondary text-ink-muted">
                        <Icon name="warning" size="sm" weight="fill" className="text-lamp" />
                        {t('web.fee-record.intent-warning', {
                          time: formatDateTime(charge.activeIntent.since),
                        })}
                      </p>
                    )}
                  </Td>
                  <Td>{formatDate(charge.dueDate)}</Td>
                  <Td>
                    <ChargeTag daysPastDue={charge.daysPastDue} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(charge.amount)}</Td>
                  <Td>
                    <RowMenu
                      label={t('web.fee-record.open.col.actions')}
                      items={[
                        {
                          key: 'void',
                          label: t('web.fee-record.open.void'),
                          danger: true,
                          disabled: !canWrite,
                          onSelect: () => openDialog({ dialog: 'void', charge: charge.chargeId }),
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </DataTable>
      </section>

      <ReceiptHistory
        unitId={unitId}
        first={debt}
        seedCursor={search.payments}
        onView={viewReceipt}
        onVoid={(paymentId) => openDialog({ dialog: 'void-payment', payment: paymentId })}
        canWrite={canWrite}
      />

      <PaymentDialog
        open={search.dialog === 'payment'}
        openCharges={openCharges}
        unitId={unitId}
        unitCode={debt.unit.code}
        ownerName={debt.owner.name}
        outstanding={summary.outstanding}
        selectedChargeIds={selected}
        isAdmin={me.data?.role === 'admin'}
        onClose={() => closeDialog({ charge: undefined, payment: undefined })}
        onPaid={() => setSelected([])}
        onConflict={() => void query.refetch()}
      />
      <VoidPaymentDialog
        open={search.dialog === 'void-payment'}
        unitId={unitId}
        payment={voidPayment}
        onClose={() => closeDialog({ payment: undefined })}
        onVoided={() => void query.refetch()}
      />
      <ChargeVoidDialog
        open={search.dialog === 'void'}
        target={voidTarget}
        onClose={() => closeDialog({ charge: undefined })}
        onVoided={() => void query.refetch()}
      />
    </>
  )
}

/** The receipt history of the unit: the first page from the debt read, then one appended page per "load more" (DOC-66 §5). */
function ReceiptHistory({
  unitId,
  first,
  seedCursor,
  onView,
  onVoid,
  canWrite,
}: {
  unitId: string
  first: Debt
  seedCursor: string | undefined
  onView: (receiptId: string, number: string) => void
  onVoid: (paymentId: string) => void
  canWrite: boolean
}) {
  const { t } = useI18n()
  const [cursors, setCursors] = useState<string[]>(() => (seedCursor ? [seedCursor] : []))
  const [tail, setTail] = useState<string | null>(null)
  const pages: (string | undefined)[] = [undefined, ...cursors]
  return (
    <section aria-labelledby="receipt-history">
      <h2 id="receipt-history" className="mb-3 text-title-3 text-ink">
        {t('web.fee-record.receipts.title')}
      </h2>
      <DataTable
        label={t('web.fee-record.receipts.title')}
        minWidth="min-w-[1040px]"
        footer={
          tail ? (
            <Button variant="outline" onClick={() => setCursors((current) => [...current, tail])}>
              {t('web.fee-record.receipts.more')}
            </Button>
          ) : undefined
        }
      >
        <THead>
          <Tr>
            <Th className="w-44">{t('web.fee-record.receipts.col.number')}</Th>
            <Th className="w-32">{t('web.fee-record.receipts.col.method')}</Th>
            <Th className="w-32">{t('web.fee-record.receipts.col.date')}</Th>
            <Th>{t('web.fee-record.receipts.col.payer')}</Th>
            <Th className="w-32 text-right">{t('web.fee-record.receipts.col.amount')}</Th>
            <Th className="w-40">{t('web.fee-record.receipts.col.status')}</Th>
            <Th className="w-40">
              <span className="sr-only">{t('web.fee-record.receipts.col.actions')}</span>
            </Th>
          </Tr>
        </THead>
        {pages.map((cursor, index) => (
          <ReceiptPage
            key={cursor ?? 'first'}
            unitId={unitId}
            cursor={cursor}
            first={index === 0 ? first : undefined}
            last={index === pages.length - 1}
            canWrite={canWrite}
            onView={onView}
            onVoid={onVoid}
            onTail={setTail}
          />
        ))}
      </DataTable>
    </section>
  )
}

function ReceiptPage({
  unitId,
  cursor,
  first,
  last,
  canWrite,
  onView,
  onVoid,
  onTail,
}: {
  unitId: string
  cursor: string | undefined
  first: Debt | undefined
  last: boolean
  canWrite: boolean
  onView: (receiptId: string, number: string) => void
  onVoid: (paymentId: string) => void
  onTail: (cursor: string | null) => void
}) {
  const { t, formatDate, formatMoney } = useI18n()
  const page = useQuery({ ...unitDebtQuery(unitId, cursor), enabled: first === undefined })
  const data = first ?? page.data

  useEffect(() => {
    if (last && data) onTail(data.nextCursor ?? null)
  }, [last, data, onTail])

  if (!data)
    return page.isError ? (
      <TBody>
        <Tr>
          <Td colSpan={7} className="text-secondary text-ink-muted">
            {t('common.error.page.body')}
          </Td>
        </Tr>
      </TBody>
    ) : (
      <SkeletonRows columns={7} rows={2} rowClassName="h-[65px]" />
    )

  const payments = data.payments
  if (payments.length === 0 && cursor === undefined)
    return (
      <TBody>
        <Tr>
          <Td colSpan={7} className="text-secondary text-ink-muted" data-testid="receipt-empty">
            {t('web.fee-record.receipts.empty')}
          </Td>
        </Tr>
      </TBody>
    )

  return (
    <TBody>
      {payments.map((payment) => (
        <Tr key={payment.paymentId} data-testid="receipt-row">
          <Td>
            <div className="flex flex-wrap items-center gap-1">
              {payment.receipts.map((receipt) => (
                <Plate key={receipt.id}>{receipt.number}</Plate>
              ))}
            </div>
          </Td>
          <Td>{methodLabel(payment.source, t)}</Td>
          <Td>{formatDate(payment.receivedAt)}</Td>
          <Td>{payment.payerName ?? t('common.table.empty-cell')}</Td>
          <Td className="text-right tabular-nums">{formatMoney(payment.amount)}</Td>
          <Td>
            <div className="flex flex-wrap items-center gap-1">
              <Tag tone={payment.status === 'posted' ? 'success' : 'neutral'}>
                {t(
                  payment.status === 'posted'
                    ? 'web.fee-record.receipt.status.valid'
                    : 'web.fee-record.receipt.status.void',
                )}
              </Tag>
              {payment.moneyLogFlags.map((flag) => (
                <Tag key={flag.rowId} tone={flag.outcome === 'refunded' ? 'info' : 'warning'}>
                  {t(
                    flag.outcome === 'refunded'
                      ? 'web.fee-record.receipt.refunded'
                      : 'web.fee-record.receipt.disputed',
                  )}
                </Tag>
              ))}
            </div>
          </Td>
          <Td>
            <div className="flex flex-wrap items-center gap-1">
              {payment.receipts.map((receipt) => (
                <Button
                  key={receipt.id}
                  size="sm"
                  variant="ghost"
                  icon="download-simple"
                  data-testid="receipt-view"
                  onClick={() => onView(receipt.id, receipt.number)}
                >
                  {t('web.fee-record.receipt.view')}
                </Button>
              ))}
              {canWrite && payment.status === 'posted' && payment.source !== 'online' && (
                <Button
                  size="sm"
                  variant="danger-ghost"
                  data-testid="receipt-void"
                  onClick={() => onVoid(payment.paymentId)}
                >
                  {t('web.fee-record.receipt.void')}
                </Button>
              )}
            </div>
          </Td>
        </Tr>
      ))}
    </TBody>
  )
}

function methodLabel(source: Payment['source'], t: ReturnType<typeof useI18n>['t']): string {
  if (source === 'cash') return t('web.fee-record.pay.method.cash')
  if (source === 'bank_transfer') return t('web.fee-record.pay.method.bank_transfer')
  return t('web.fee-record.receipt.method.online')
}

/** The shape of the page while the debt loads: the header, the three tiles and the two tables in their rows. */
function RecordSkeleton(): ReactElement {
  const { t } = useI18n()
  return (
    <div aria-hidden="true">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-9 w-24 rounded-plate" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-3.5 w-72" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-control-md w-32" />
          <Skeleton className="h-control-md w-36" />
        </div>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <Card key={tile} className="p-5">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="mt-3 h-3.5 w-32" />
          </Card>
        ))}
      </div>
      <Skeleton className="mb-3 h-6 w-32" />
      <DataTable label={t('web.fee-record.open.title')} minWidth="min-w-[960px]">
        <THead>
          <Tr>
            <Th className="w-10" />
            <Th className="w-32">{t('web.fee-record.open.col.batch')}</Th>
            <Th>{t('web.fee-record.open.col.name')}</Th>
            <Th className="w-36">{t('web.fee-record.open.col.due')}</Th>
            <Th className="w-32">{t('web.fee-record.open.col.status')}</Th>
            <Th className="w-32">{t('web.fee-record.open.col.amount')}</Th>
            <Th className="w-12" />
          </Tr>
        </THead>
        <SkeletonRows columns={7} rows={3} rowClassName="h-[61px]" />
      </DataTable>
      <Skeleton className="mt-6 mb-3 h-6 w-40" />
      <DataTable label={t('web.fee-record.receipts.title')} minWidth="min-w-[1040px]">
        <SkeletonRows columns={8} rows={3} rowClassName="h-[65px]" />
      </DataTable>
    </div>
  )
}

/** "Send a reminder" (E-103): one press reminds this unit; a second the same day answers `alreadyRemindedToday`. */
function SendReminderButton({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const { t } = useI18n()
  const { sendReminders } = useDebtMutations()
  const remind = () => {
    sendReminders.mutate(
      { unitIds: [unitId], key: crypto.randomUUID() },
      {
        onSuccess: (result) => {
          if (result.sent > 0) toast.success(t('web.fee-record.remind.done'))
          else if (result.alreadyRemindedToday > 0) toast.success(t('web.fee-record.remind.today'))
          else if (result.noDebt > 0) toast.error(t('web.fee-record.remind.no-debt'))
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          toast.error(
            failure.code === 'rate_limited'
              ? t('web.fee-record.remind.rate-limited')
              : errorText(t, failure),
          )
        },
      },
    )
  }
  return (
    <Button
      variant="outline"
      icon="bell"
      data-testid="send-reminder"
      disabled={!canWrite || sendReminders.isPending}
      loading={sendReminders.isPending}
      onClick={remind}
    >
      {t('web.fee-record.action.remind')}
    </Button>
  )
}
