import type { pdfEn } from './en'

/**
 * The printed labels of the fee notice and the receipt (DOC-34 §5–§7, DR-295) in Vietnamese, the
 * default language (DR-71).
 */
export const pdfVi: Record<keyof typeof pdfEn, string> = {
  'pdf.common.page': 'Trang {page}/{total}',
  'pdf.common.unit': 'Căn hộ',
  'pdf.common.batch': 'Đợt phí',
  'pdf.common.item': 'Khoản phí',
  'pdf.common.amount': 'Thành tiền',
  'pdf.common.hotline': 'Hotline {hotline}',
  'pdf.common.quantity_price': '{quantity} × {unitPrice}',
  'pdf.common.adjustment': 'Điều chỉnh',

  'pdf.fee_notice.title': 'Thông báo phí tháng {month}',
  'pdf.fee_notice.owner': 'Chủ hộ',
  'pdf.fee_notice.issue_date': 'Ngày phát hành',
  'pdf.fee_notice.basis': 'Cách tính',
  'pdf.fee_notice.total': 'Tổng cộng',
  'pdf.fee_notice.due_date': 'Hạn thanh toán',
  'pdf.fee_notice.how_to_pay': 'Hướng dẫn nộp phí',
  'pdf.fee_notice.pay_app':
    'Thanh toán trên App cư dân bằng mã QR, gạch nợ ngay khi thanh toán thành công.',
  'pdf.fee_notice.pay_office': 'Nộp tại văn phòng Ban quản lý, {workingHours}.',
  'pdf.fee_notice.questions':
    'Thắc mắc về phí, bạn gọi hotline {hotline} hoặc gửi yêu cầu trên App cư dân.',
  'pdf.fee_notice.questions_no_hotline': 'Thắc mắc về phí, bạn gửi yêu cầu trên App cư dân.',
  'pdf.fee_notice.draft_mark': 'BẢN NHÁP',

  'pdf.receipt.title': 'BIÊN LAI THU TIỀN',
  'pdf.receipt.number': 'Số',
  'pdf.receipt.date': 'Ngày',
  'pdf.receipt.payer': 'Người nộp',
  'pdf.receipt.member_owner': 'Chủ hộ',
  'pdf.receipt.member_member': 'Thành viên',
  'pdf.receipt.member_tenant': 'Người thuê',
  'pdf.receipt.fee_month': 'Kỳ phí',
  'pdf.receipt.quantity_price': 'Số lượng × Đơn giá',
  'pdf.receipt.total': 'Số tiền',
  'pdf.receipt.in_words': 'Bằng chữ',
  'pdf.receipt.method': 'Hình thức',
  'pdf.receipt.method_online': 'Thanh toán trực tuyến',
  'pdf.receipt.method_cash': 'Tiền mặt',
  'pdf.receipt.method_bank_transfer': 'Chuyển khoản',
  'pdf.receipt.method_other': 'Khác',
  'pdf.receipt.reference': 'Mã giao dịch',
  'pdf.receipt.paid_at': 'Thời điểm thanh toán',
  'pdf.receipt.statement':
    'Biên lai này xác nhận khoản đã thu, không phải hóa đơn giá trị gia tăng.',
  'pdf.receipt.issued_by': 'Người lập',
  'pdf.receipt.signature_payer': 'Người nộp tiền',
  'pdf.receipt.signature_collector': 'Người thu tiền',
  'pdf.receipt.void_stamp': 'ĐÃ HỦY',
  'pdf.receipt.voided_on': 'ĐÃ HỦY ngày {date}',
  'pdf.receipt.void_reason': 'Lý do hủy',
  'pdf.receipt.void_date': 'Ngày hủy',
}
