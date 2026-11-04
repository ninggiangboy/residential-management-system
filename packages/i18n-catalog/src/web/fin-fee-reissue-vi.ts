import type { finFeeReissueEn } from './fin-fee-reissue-en'

/** DOC-66 `fee-reissue` microcopy (Vietnamese). */
export const finFeeReissueVi: Record<keyof typeof finFeeReissueEn, string> = {
  'web.fee-reissue.code': 'Mã đợt mới được cấp khi tạo.',
  'web.fee-reissue.copied': '{count} khoản phí được sao chép, kèm các dòng',
  'web.fee-reissue.done': 'Đã tạo bản nháp {code} từ {oldCode}.',
  'web.fee-reissue.due': 'Hạn thanh toán',
  'web.fee-reissue.intro': 'Hệ thống tạo một đợt nháp mới từ đợt đã thu hồi:',
  'web.fee-reissue.month': 'Tháng phí giữ nguyên: {month}/{year}',
  'web.fee-reissue.note': 'Đợt mới là bản nháp. Bạn sửa rồi phát hành.',
  'web.fee-reissue.skipped': '{count} khoản đã hủy riêng không sao chép: {units}',
  'web.fee-reissue.skipped.more': 'và {count} căn khác',
  'web.fee-reissue.submit': 'Tạo bản nháp',
  'web.fee-reissue.title': 'Phát hành lại {code}',
}
