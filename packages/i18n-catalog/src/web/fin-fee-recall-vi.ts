import type { finFeeRecallEn } from './fin-fee-recall-en'

/** DOC-66 `fee-recall` microcopy (Vietnamese). */
export const finFeeRecallVi: Record<keyof typeof finFeeRecallEn, string> = {
  'web.fee-recall.blocked.body':
    'Đã có {count, plural, one {# khoản} other {# khoản}} được thanh toán. Không có gì bị thay đổi.',
  'web.fee-recall.blocked.hint':
    'Muốn sửa một khoản sai, hãy hủy từng khoản chưa thanh toán. Khoản đã thanh toán thì bù bằng khoản điều chỉnh trong đợt sau.',
  'web.fee-recall.blocked.title': 'Không thu hồi được',
  'web.fee-recall.blocked.view': 'Xem {count} khoản đã thanh toán',
  'web.fee-recall.body':
    '{count} khoản phí sẽ bị hủy. Cư dân không còn thấy và không thanh toán được các khoản này. Lượt thanh toán online đang mở sẽ bị hủy.',
  'web.fee-recall.conflict': 'Đợt phí đã thay đổi. Đã cập nhật.',
  'web.fee-recall.done': 'Đã thu hồi {code}. {count} khoản đã hủy.',
  'web.fee-recall.not-published': 'Chỉ thu hồi được đợt đã phát hành, chưa đóng.',
  'web.fee-recall.reason': 'Lý do',
  'web.fee-recall.reason.counter': '{count} / {max}',
  'web.fee-recall.reason.placeholder': 'Nhập sai đơn giá phí quản lý',
  'web.fee-recall.submit': 'Thu hồi đợt',
  'web.fee-recall.title': 'Thu hồi đợt {code}?',
}
