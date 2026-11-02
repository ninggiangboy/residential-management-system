/**
 * Stand-ins for the tables the grants step names (DOC-19 §4): until a module's migration creates its real table, a table with
 * the same schema, name and sensitive columns lets the matrix of DOC-19 §9 run against `0900-grants.sql`, which is the thing
 * under test. When a module lands, its tables are created by its migration and its stand-in is deleted from here; the catalog
 * checks (GRT-89…97) already run over every real table.
 */
export const STAND_INS = `
  CREATE TABLE notification.device_token (id uuid PRIMARY KEY, token text NOT NULL);

`

/** The rows the statements touch, inserted by the superuser first (DOC-19 §9.1). */
export const SEED = `
  INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash)
    VALUES ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002', 'admin@example.invalid', 'Admin', 'admin', 'active', 'argon2id$x');
  INSERT INTO building.building (id, code, name, company, address) VALUES ('00000000-0000-7000-8000-000000000002', 'DEMO-A', '{"vi":"Demo"}', '{"name":{"vi":"Demo"}}', '1 Demo Street');
  INSERT INTO building.gateway_config (id, building_id, provider, driver, secrets_enc, receiving_account, status)
    VALUES ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000002', 'payos', 'fake', 'v1:k1:aa:bb', '{"accountNumber":"123"}', 'active');
  INSERT INTO residency.resident_profile (building_id, account_id, full_name, cccd_last4, cccd_enc, date_of_birth)
    VALUES ('00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000004', 'Nguyễn Văn An', '1234', 'v1:k1:cccd', '1990-01-01');
  INSERT INTO finance.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at)
    VALUES ('00000000-0000-7000-8000-000000000005', 'identity.sms_requested.v1', 'x', '{"secretEnc": "x"}', '{}', now());
  INSERT INTO audit.audit_log (id, building_id, actor_kind, action, object_type, object_id)
    VALUES ('00000000-0000-7000-8000-000000000006', '00000000-0000-7000-8000-000000000002', 'system', 'x.y.z', 'x', '00000000-0000-7000-8000-000000000002');
  INSERT INTO platform.maintenance (id, active) VALUES (true, false);`
