/** DOC-66 `fee-recall` microcopy (English); keys sorted, one pair of files per screen so the slices do not share a file. */
export const finFeeRecallEn = {
  'web.fee-recall.blocked.body':
    '{count, plural, one {# charge has} other {# charges have}} been paid. Nothing was changed.',
  'web.fee-recall.blocked.hint':
    'To fix a wrong charge, void the unpaid ones one by one. Offset a paid one with an adjustment line in a later batch.',
  'web.fee-recall.blocked.title': 'The batch cannot be recalled',
  'web.fee-recall.blocked.view': 'View the {count} paid charges',
  'web.fee-recall.body':
    '{count} charges will be voided. Residents no longer see them or can pay them. Online payments in progress are cancelled.',
  'web.fee-recall.conflict': 'The batch changed. It is up to date.',
  'web.fee-recall.done': 'Recalled {code}. {count} charges voided.',
  'web.fee-recall.not-published': 'Only a published, open batch can be recalled.',
  'web.fee-recall.reason': 'Reason',
  'web.fee-recall.reason.counter': '{count} / {max}',
  'web.fee-recall.reason.placeholder': 'Management fee priced wrongly',
  'web.fee-recall.submit': 'Recall the batch',
  'web.fee-recall.title': 'Recall {code}?',
} as const
