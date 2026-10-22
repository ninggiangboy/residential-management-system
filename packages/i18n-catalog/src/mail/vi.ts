import type { mailEn } from './en'

/** The staff mails of `identity` in Vietnamese, the default language (DR-71). */
export const mailVi: Record<keyof typeof mailEn, string> = {
  'mail.staff_invite.subject': 'Đặt mật khẩu của bạn',
  'mail.staff_invite.body':
    'Xin chào {name},\n\nMột tài khoản đã được tạo cho bạn. Mở liên kết sau để đặt mật khẩu. Liên kết chỉ dùng được một lần và hết hạn sau {hours} giờ:\n\n{link}\n\nNếu bạn không mong đợi thư này, hãy bỏ qua nó.',
  'mail.password_reset.subject': 'Đặt lại mật khẩu',
  'mail.password_reset.body':
    'Xin chào {name},\n\nMở liên kết sau để chọn mật khẩu mới. Liên kết chỉ dùng được một lần và hết hạn sau {minutes} phút:\n\n{link}\n\nNếu bạn không yêu cầu, hãy bỏ qua thư này. Mật khẩu của bạn vẫn như cũ.',
  'mail.step_up_code.subject': 'Mã xác nhận của bạn',
  'mail.step_up_code.body':
    'Xin chào {name},\n\nMã xác nhận cho "{action}" là {code}. Mã chỉ dùng được một lần và hết hạn sau {minutes} phút. Đừng chia sẻ mã này với ai.',
  'mail.step_up_notice.subject': 'Một thay đổi nhạy cảm đã được thực hiện',
  'mail.step_up_notice.body':
    'Xin chào {name},\n\n{actorName} đã xác nhận một thay đổi nhạy cảm: {action}. Nếu bạn không mong đợi điều này, hãy liên hệ quản trị viên.',
  'mail.action.gateway_config': 'cấu hình cổng thanh toán',
  'mail.action.admin_change': 'tài khoản quản trị viên',
  'mail.action.staff_email': 'email của nhân viên',
}
