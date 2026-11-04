/** DOC-66 `charge-void` microcopy (English); keys sorted, one pair of files per screen so the slices do not share a file. */
export const finChargeVoidEn = {
  'web.charge-void.body':
    'A voided fee cannot be reopened. To bill it correctly, add a new charge in a draft batch.',
  'web.charge-void.done': 'Voided the fee of {unit}.',
  'web.charge-void.intent':
    'An online payment is open for this fee (since {time}). It will be cancelled and the resident must pay again.',
  'web.charge-void.lost': 'This fee was just paid and cannot be voided.',
  'web.charge-void.reason': 'Reason',
  'web.charge-void.reason.counter': '{count} / {max}',
  'web.charge-void.reason.placeholder': 'Billed to the wrong unit',
  'web.charge-void.submit': 'Void the fee',
  'web.charge-void.summary': '{batch} · {owner} · {amount}',
  'web.charge-void.title': 'Void the fee of {unit}?',
} as const
