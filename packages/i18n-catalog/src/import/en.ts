/**
 * The texts of the units-and-owners import (DOC-18 §1.2): the issue of a row and the note of a valid row, rendered by the API in
 * the language of the request (`message` of E-72 and E-73). The key is `common.import.<code>`; the code is the contract with the
 * client. The key set is part of `en` of `catalog.ts`.
 */
export const importEn = {
  'common.import.import_file_type': 'The file must be an Excel workbook (.xlsx).',
  'common.import.import_no_header':
    'The first row must contain the “Unit code” column. Use the template.',
  'common.import.import_duplicate_column': 'Two columns are both “{column}”. Keep one.',
  'common.import.import_empty': 'The file has no data rows.',
  'common.import.import_unknown_column': 'Column “{column}” is not recognised and is ignored.',
  'common.import.unit_code_invalid':
    'Unit code must be 1–20 letters, digits, dots, hyphens or slashes.',
  'common.import.floor_invalid': 'Floor must be a whole number from −5 to 150.',
  'common.import.bedrooms_invalid': 'Bedrooms must be a whole number from 0 to 20.',
  'common.import.area_invalid':
    'Area must be above 0 and at most {max, number} m², with at most 2 decimals.',
  'common.import.occupancy_invalid': 'Occupancy must be occupied, rented or vacant.',
  'common.import.owner_name_required': 'Owner name is required when other owner details are given.',
  'common.import.owner_phone_required':
    'Owner phone is required when other owner details are given.',
  'common.import.owner_name_invalid': 'Owner name must be 2–100 characters and contain a letter.',
  'common.import.phone_invalid': 'This phone number is not valid.',
  'common.import.phone_not_mobile':
    'This looks like a landline; it may not receive the sign-in SMS.',
  'common.import.email_invalid': 'This email address is not valid.',
  'common.import.id_number_invalid': 'ID number must be 9 or 12 digits.',
  'common.import.id_number_padded':
    'The ID number lost its leading zeros in Excel; it was padded to 12 digits. Check it.',
  'common.import.dob_invalid':
    'Date of birth must be DD/MM/YYYY (or an Excel date) between 1900 and today.',
  'common.import.unit_code_duplicate': 'Unit {code} already appears in row {firstRow}.',
  'common.import.phone_conflict': 'This phone number is used for another person in row {firstRow}.',
  'common.import.unit_will_update': 'Unit {code} exists and will be updated.',
  'common.import.unit_will_create': 'Unit {code} will be created.',
  'common.import.owner_conflict': 'Unit {code} already has another owner. Use ownership transfer.',
  'common.import.owner_is_member':
    'This person is already a member of unit {code}. Change their role on the unit page.',
  'common.import.account_linked':
    'This phone already has an account; the owner is linked to it and the name in the file is not used.',
  'common.import.account_will_be_created': 'A new resident account will be created for this phone.',
  'common.import.unit_type_unknown':
    'There is no unit type “{value}”. Use a code or a name from the Unit types screen.',
  'common.import.unit_type_archived': 'The unit type “{value}” is no longer in use.',
  'common.import.unit_type_defaults_applied':
    'Unit {code} will take the default {fields, select, bedrooms {bedrooms} area {area} other {bedrooms and area}} of the type “{type}”.',
  'common.import.profile_field_differs':
    '{field} differs from the stored profile and is not changed.',
} as const
