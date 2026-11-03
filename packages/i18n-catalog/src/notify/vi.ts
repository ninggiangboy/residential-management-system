import type { notifyEn } from './en'

/** The `notify.*` texts of DOC-31 §3.4 in Vietnamese, the default language (DR-71). */
export const notifyVi: Record<keyof typeof notifyEn, string> = {
  'notify.fee.batch_published.title': 'Phí {feeMonth} đã phát hành',
  'notify.fee.batch_published.body': 'Đợt phí {batchCode} đã có. Mở ứng dụng để xem chi tiết.',
  'notify.fee.batch_recalled.title': 'Đợt phí {batchCode} đã được thu hồi',
  'notify.fee.batch_recalled.body':
    'Ban quản lý đã thu hồi đợt phí này. Các khoản phí của đợt không cần thanh toán nữa.',
  'notify.fee.batch_due_extended.title': 'Gia hạn đợt phí {batchCode}',
  'notify.fee.batch_due_extended.body': 'Hạn thanh toán mới là {dueDate}.',
  'notify.fee.charge_voided.title': 'Một khoản phí {feeMonth} đã được hủy',
  'notify.fee.charge_voided.body':
    'Ban quản lý đã hủy một khoản phí. Khoản phí đúng, nếu có, sẽ được phát hành lại.',
  'notify.fee.reminder.title': 'Nhắc thanh toán phí',
  'notify.fee.reminder.body': 'Căn hộ còn khoản phí chưa thanh toán. Mở ứng dụng để xem.',
  'notify.payment.received.title': 'Đã nhận thanh toán',
  'notify.payment.received.body':
    'Ban quản lý đã ghi nhận một khoản thanh toán. Biên lai có trong ứng dụng.',
  'notify.payment.voided.title': 'Một khoản thanh toán đã bị hủy',
  'notify.payment.voided.body':
    'Ban quản lý đã hủy một khoản thanh toán đã ghi. Mở ứng dụng để xem.',
  'notify.finance.money_unposted.title': 'Có khoản tiền cần kiểm tra',
  'notify.finance.money_unposted.body':
    'Một khoản chuyển khoản chưa được ghi nhận. Xem nhật ký tiền.',
  'notify.staff.step_up_done.title': 'Đã xác minh một thay đổi quan trọng',
  'notify.staff.step_up_done.body':
    '{actorName} đã {action, select, gateway_config {đổi cấu hình cổng thanh toán} admin_change {tạo hoặc nâng quyền một Quản trị} staff_email {đổi email của một nhân viên} other {thực hiện một thay đổi quan trọng}}.',
  'notify.member.added.title': 'Bạn đã được thêm vào một căn hộ',
  'notify.member.added.body': 'Mở ứng dụng để xem căn hộ.',
  'notify.ticket.new_unassigned.title': 'Phiếu mới {ticketCode}',
  'notify.ticket.new_unassigned.body': 'Có phiếu hỗ trợ mới chưa được giao.',
  'notify.ticket.assigned.title': 'Bạn được giao phiếu {ticketCode}',
  'notify.ticket.assigned.body': 'Mở ứng dụng để nhận hoặc từ chối.',
  'notify.ticket.status_changed.title': 'Yêu cầu {ticketCode} đã cập nhật',
  'notify.ticket.status_changed.body': 'Trạng thái mới: {status}.',
  'notify.ticket.commented.title': 'Yêu cầu {ticketCode} có phản hồi mới',
  'notify.ticket.commented.body': 'Mở ứng dụng để xem.',
  'notify.ticket.rejected.title': 'Phiếu {ticketCode} bị từ chối',
  'notify.ticket.rejected.body': 'Kỹ thuật viên đã từ chối phiếu. Hãy giao lại.',
  'notify.ticket.awaiting_close.title': 'Phiếu {ticketCode} chờ đóng',
  'notify.ticket.awaiting_close.body': 'Công việc đã xong. Hãy kiểm tra và đóng phiếu.',
  'notify.notice.published.title': 'Thông báo mới: {noticeTitle}',
  'notify.notice.published.body': 'Mở ứng dụng để đọc.',
  'notify.vehicle.pending_review.title': 'Có phương tiện chờ duyệt',
  'notify.vehicle.pending_review.body': 'Một đăng ký phương tiện đang chờ duyệt.',
  'notify.vehicle.approved.title': 'Phương tiện đã được duyệt',
  'notify.vehicle.approved.body': 'Đăng ký phương tiện của căn hộ đã được duyệt.',
  'notify.vehicle.rejected.title': 'Phương tiện chưa được duyệt',
  'notify.vehicle.rejected.body': 'Mở ứng dụng để xem lý do và sửa đăng ký.',
  'notify.report.export_ready.title': 'Tệp xuất đã sẵn sàng',
  'notify.report.export_ready.body': 'Tệp có trong Trung tâm xuất trong 7 ngày.',
}
