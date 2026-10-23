import type { smsEn } from './en'

/**
 * The SMS texts in Vietnamese, the default language (DR-71). They carry no diacritics: the brandname rule of the carriers
 * (DR-37) sends one 160-character part only in the GSM alphabet, and one accented letter would turn it into several parts.
 */
export const smsVi: Record<keyof typeof smsEn, string> = {
  'sms.otp': '{code} la ma xac thuc dang nhap {brand}. Co hieu luc 5 phut. Khong chia se ma nay.',
  'sms.member_invitation':
    'Ban duoc moi vao can ho {unitCode} tren ung dung {brand}. Tai ung dung va dang nhap bang so dien thoai nay: {appUrl}',
}
