import type { finChargeVoidEn } from './fin-charge-void-en'

/** DOC-66 `charge-void` microcopy (Vietnamese). */
export const finChargeVoidVi: Record<keyof typeof finChargeVoidEn, string> = {
  'web.charge-void.body':
    'Khoản đã hủy không mở lại được. Muốn thu đúng, hãy tạo khoản mới trong một đợt nháp.',
  'web.charge-void.done': 'Đã hủy khoản phí của {unit}.',
  'web.charge-void.intent':
    'Đang có thanh toán online cho khoản này (từ {time}). Lượt thanh toán sẽ bị hủy và cư dân phải thanh toán lại.',
  'web.charge-void.lost': 'Khoản này vừa được thanh toán, không hủy được.',
  'web.charge-void.reason': 'Lý do',
  'web.charge-void.reason.counter': '{count} / {max}',
  'web.charge-void.reason.placeholder': 'Tính nhầm căn',
  'web.charge-void.submit': 'Hủy khoản phí',
  'web.charge-void.summary': '{batch} · {owner} · {amount}',
  'web.charge-void.title': 'Hủy khoản phí của {unit}?',
}
