/** Vietnamese texts of the units-and-owners import (DOC-18 §1.2); same keys and arguments as `en.ts`. */
export const importVi = {
  'common.import.import_file_type': 'Tệp phải là sổ làm việc Excel (.xlsx).',
  'common.import.import_no_header': 'Dòng đầu tiên phải có cột “Mã căn hộ”. Hãy dùng tệp mẫu.',
  'common.import.import_duplicate_column': 'Có hai cột cùng là “{column}”. Hãy giữ một cột.',
  'common.import.import_empty': 'Tệp không có dòng dữ liệu.',
  'common.import.import_unknown_column': 'Cột “{column}” không được nhận diện nên bị bỏ qua.',
  'common.import.unit_code_invalid':
    'Mã căn hộ gồm 1–20 ký tự: chữ, số, dấu chấm, gạch ngang hoặc gạch chéo.',
  'common.import.floor_invalid': 'Tầng phải là số nguyên từ −5 đến 150.',
  'common.import.bedrooms_invalid': 'Số phòng ngủ phải là số nguyên từ 0 đến 20.',
  'common.import.area_invalid':
    'Diện tích phải lớn hơn 0 và không quá {max, number} m², tối đa 2 chữ số thập phân.',
  'common.import.occupancy_invalid': 'Tình trạng phải là: đang ở, cho thuê hoặc trống.',
  'common.import.owner_name_required': 'Cần có họ tên chủ hộ khi đã nhập thông tin chủ hộ.',
  'common.import.owner_phone_required': 'Cần có số điện thoại chủ hộ khi đã nhập thông tin chủ hộ.',
  'common.import.owner_name_invalid': 'Họ tên chủ hộ phải có 2–100 ký tự và có chữ cái.',
  'common.import.phone_invalid': 'Số điện thoại không hợp lệ.',
  'common.import.phone_not_mobile':
    'Đây có vẻ là số máy bàn, có thể không nhận được tin nhắn đăng nhập.',
  'common.import.email_invalid': 'Địa chỉ email không hợp lệ.',
  'common.import.id_number_invalid': 'Số CCCD/CMND phải gồm 9 hoặc 12 chữ số.',
  'common.import.id_number_padded':
    'Số CCCD bị mất số 0 ở đầu trong Excel; đã bổ sung cho đủ 12 chữ số. Hãy kiểm tra lại.',
  'common.import.dob_invalid':
    'Ngày sinh phải theo dạng DD/MM/YYYY (hoặc ô ngày của Excel), từ năm 1900 đến hôm nay.',
  'common.import.unit_code_duplicate': 'Căn hộ {code} đã có ở dòng {firstRow}.',
  'common.import.phone_conflict': 'Số điện thoại này đã dùng cho người khác ở dòng {firstRow}.',
  'common.import.unit_will_update': 'Căn hộ {code} đã có và sẽ được cập nhật.',
  'common.import.unit_will_create': 'Căn hộ {code} sẽ được tạo mới.',
  'common.import.owner_conflict':
    'Căn hộ {code} đã có chủ hộ khác. Hãy dùng chức năng chuyển chủ hộ.',
  'common.import.owner_is_member':
    'Người này đã là thành viên của căn hộ {code}. Hãy đổi vai trò ở trang căn hộ.',
  'common.import.account_linked':
    'Số này đã có tài khoản; chủ hộ được liên kết với tài khoản đó và không dùng tên trong tệp.',
  'common.import.account_will_be_created': 'Sẽ tạo tài khoản cư dân mới cho số này.',
  'common.import.profile_field_differs': '{field} khác với hồ sơ đã lưu nên không được thay đổi.',
} as const
