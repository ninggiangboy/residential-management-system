import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { SelectField } from '../../components/ui/select-field'
import { StatusTag } from '../../components/ui/tag'
import { TextAreaField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'
import { assigneesQuery } from './hooks'

export interface OpenTicket {
  ticketId: string
  code: string
  status: string
}

/**
 * The 409 `staff_has_open_tickets` of a lock, a disable or a role change (DOC-67 `W-Staff` §6): the Admin names who takes the
 * tickets and why (5 to 500 characters); a Manager sees the list and is told to ask an Admin (FR-14.3).
 */
export function OpenTicketsDialog({
  open,
  name,
  tickets,
  canReassign,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  name: string
  tickets: readonly OpenTicket[]
  canReassign: boolean
  pending: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (reassign: { reassignTo: string; reason: string }) => void
}) {
  const { t } = useI18n()
  const [assignee, setAssignee] = useState('')
  const [reason, setReason] = useState('')
  const assignees = useQuery({ ...assigneesQuery(), enabled: open && canReassign })
  const reasonTooShort = reason.trim().length < 5 || reason.trim().length > 500

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('web.staff.dialog.open-tickets.title', { name, count: tickets.length })}
      description={t(
        canReassign
          ? 'web.staff.dialog.open-tickets.body.admin'
          : 'web.staff.dialog.open-tickets.body.manager',
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.action.cancel')}
          </Button>
          {canReassign && (
            <Button
              loading={pending}
              disabled={assignee === '' || reasonTooShort}
              onClick={() => onSubmit({ reassignTo: assignee, reason: reason.trim() })}
            >
              {t('web.staff.dialog.open-tickets.confirm')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        {error && <Banner tone="danger">{error}</Banner>}
        <ul className="divide-y divide-line rounded-control border border-line">
          {tickets.map((ticket) => (
            <li key={ticket.ticketId} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="text-body-strong">{ticket.code}</span>
              <StatusTag entity="ticket" value={ticket.status} />
            </li>
          ))}
        </ul>
        {canReassign && (
          <>
            <SelectField
              label={t('web.staff.dialog.open-tickets.field.assignee.label')}
              value={assignee}
              onValueChange={setAssignee}
              options={(assignees.data ?? []).map((person) => ({
                value: person.id,
                label: `${person.fullName} (${t(`common.staff-role.${person.role}`)})`,
              }))}
            />
            <TextAreaField
              label={t('web.staff.dialog.open-tickets.field.reason.label')}
              hint={t('web.staff.dialog.open-tickets.field.reason.hint')}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </>
        )}
      </div>
    </Dialog>
  )
}
