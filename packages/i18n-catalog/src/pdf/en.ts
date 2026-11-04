/**
 * The printed labels of the fee notice and the receipt (DOC-34 §5–§7, DR-295) in English. The
 * renderer formats amounts, dates and months itself and passes strings, so every key uses plain
 * `{name}` placeholders only. This file defines the key set: `vi` has the same keys and the same
 * ICU arguments (UICP-01).
 */
export const pdfEn = {
  'pdf.common.page': 'Page {page} of {total}',
  'pdf.common.unit': 'Unit',
  'pdf.common.batch': 'Batch',
  'pdf.common.item': 'Item',
  'pdf.common.amount': 'Amount',
  'pdf.common.hotline': 'Hotline {hotline}',
  'pdf.common.quantity_price': '{quantity} × {unitPrice}',
  'pdf.common.adjustment': 'Adjustment',

  'pdf.fee_notice.title': 'Fee notice for {month}',
  'pdf.fee_notice.owner': 'Owner',
  'pdf.fee_notice.issue_date': 'Issue date',
  'pdf.fee_notice.basis': 'Basis',
  'pdf.fee_notice.total': 'Total',
  'pdf.fee_notice.due_date': 'Due date',
  'pdf.fee_notice.how_to_pay': 'How to pay',
  'pdf.fee_notice.pay_app':
    'Pay in the resident app by QR code. Your balance updates as soon as the payment succeeds.',
  'pdf.fee_notice.pay_office': 'Pay at the management office, {workingHours}.',
  'pdf.fee_notice.questions':
    'Questions about fees: call {hotline} or send a request in the resident app.',
  'pdf.fee_notice.questions_no_hotline':
    'Questions about fees: send a request in the resident app.',
  'pdf.fee_notice.draft_mark': 'DRAFT',

  'pdf.receipt.title': 'PAYMENT RECEIPT',
  'pdf.receipt.number': 'No.',
  'pdf.receipt.date': 'Date',
  'pdf.receipt.payer': 'Payer',
  'pdf.receipt.member_owner': 'Owner',
  'pdf.receipt.member_member': 'Member',
  'pdf.receipt.member_tenant': 'Tenant',
  'pdf.receipt.fee_month': 'Fee month',
  'pdf.receipt.quantity_price': 'Quantity × unit price',
  'pdf.receipt.total': 'Amount',
  'pdf.receipt.in_words': 'In words',
  'pdf.receipt.method': 'Method',
  'pdf.receipt.method_online': 'Online',
  'pdf.receipt.method_cash': 'Cash',
  'pdf.receipt.method_bank_transfer': 'Bank transfer',
  'pdf.receipt.method_other': 'Other',
  'pdf.receipt.reference': 'Reference',
  'pdf.receipt.paid_at': 'Paid at',
  'pdf.receipt.statement': 'This receipt confirms a payment received. It is not a VAT invoice.',
  'pdf.receipt.issued_by': 'Issued by',
  'pdf.receipt.signature_payer': 'Payer',
  'pdf.receipt.signature_collector': 'Collector',
  'pdf.receipt.void_stamp': 'VOID',
  'pdf.receipt.voided_on': 'Voided on {date}',
  'pdf.receipt.void_reason': 'Void reason',
  'pdf.receipt.void_date': 'Void date',
} as const
