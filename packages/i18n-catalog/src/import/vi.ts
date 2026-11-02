/** Vietnamese texts of the imports (DOC-18 §1.2, §2.2); same keys and arguments as `en.ts`. */
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
  'common.import.unit_type_unknown':
    'Không có loại căn hộ “{value}”. Hãy dùng mã hoặc tên trong màn Loại căn hộ.',
  'common.import.unit_type_archived': 'Loại căn hộ “{value}” đã ngừng dùng.',
  'common.import.unit_type_defaults_applied':
    'Căn hộ {code} sẽ lấy {fields, select, bedrooms {số phòng ngủ} area {diện tích} other {số phòng ngủ và diện tích}} mặc định của loại “{type}”.',
  'common.import.profile_field_differs': '{field} khác với hồ sơ đã lưu nên không được thay đổi.',
  // The fee file (DOC-18 §2.2, DQ-62…DQ-78).
  'common.import.import_missing_column': 'Thiếu cột bắt buộc: {columns}. Hãy dùng tệp mẫu.',
  'common.import.import_no_price': 'Cần có cột “Đơn giá” hoặc cột “Thành tiền”.',
  'common.import.fee_month_invalid': 'Tháng phí phải theo dạng MM/YYYY hoặc YYYY-MM.',
  'common.import.fee_month_mismatch':
    'Tháng phí {got} khác với tháng phí của đợt thu ({expected}).',
  'common.import.item_name_invalid': 'Tên khoản phải dài từ {min, number} đến {max, number} ký tự.',
  'common.import.kind_invalid': 'Loại dòng phải là “phí” hoặc “điều chỉnh”.',
  'common.import.quantity_invalid':
    'Số lượng phải từ 0, tối đa 3 chữ số thập phân và không quá {max, number}.',
  'common.import.unit_price_invalid': 'Đơn giá phải là số nguyên từ 0 đến {max, number} đ.',
  'common.import.amount_invalid':
    '{kind, select, adjustment {Số tiền điều chỉnh phải là số nguyên khác 0, tối đa {max, number} đ.} other {Thành tiền phải là số nguyên lớn hơn 0, tối đa {max, number} đ.}}',
  'common.import.amount_mismatch':
    'Thành tiền {got, number} đ không bằng số lượng × đơn giá ({expected, number} đ). Hãy sửa hoặc để trống cột thành tiền.',
  'common.import.adjustment_note_required': 'Dòng điều chỉnh phải có ghi chú nêu lý do.',
  'common.import.note_too_long': 'Ghi chú tối đa {max, number} ký tự.',
  'common.import.charge_item_duplicate': 'Khoản “{item}” của căn hộ này đã có ở dòng {firstRow}.',
  'common.import.charge_total_zero':
    'Tổng các dòng của căn hộ {code} là {total, number} đ, không lớn hơn 0 nên không tạo khoản thu.',
  'common.import.unit_not_found': 'Không có căn hộ {code} trong tòa nhà.',
  'common.import.unit_without_owner': 'Căn hộ {code} chưa có chủ hộ nên không có ai để báo phí.',
} as const
