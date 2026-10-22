/**
 * Stand-ins for the tables the grants step names (DOC-19 §4): until a module's migration creates its real table, a table with
 * the same schema, name and sensitive columns lets the matrix of DOC-19 §9 run against `0900-grants.sql`, which is the thing
 * under test. When a module lands, its tables are created by its migration and its stand-in is deleted from here; the catalog
 * checks (GRT-89…97) already run over every real table.
 */
export const STAND_INS = `
  CREATE TABLE identity.staff_account (id uuid PRIMARY KEY, email text NOT NULL, role text NOT NULL, status text NOT NULL, password_hash text NOT NULL);
  CREATE TABLE identity.resident_account (id uuid PRIMARY KEY, phone text NOT NULL, language text NOT NULL);
  CREATE TABLE identity.otp_challenge (id uuid PRIMARY KEY, code_hash text NOT NULL);
  CREATE TABLE identity.password_token (id uuid PRIMARY KEY, token_hash text NOT NULL);
  CREATE TABLE identity.refresh_family (id uuid PRIMARY KEY);
  CREATE TABLE identity.refresh_token (id uuid PRIMARY KEY, token_hash text NOT NULL);
  CREATE TABLE identity.rate_bucket (key text PRIMARY KEY, tokens double precision NOT NULL);
  CREATE TABLE residency.resident_profile (id uuid PRIMARY KEY, full_name text NOT NULL, cccd_last4 text, cccd_enc text, date_of_birth date);
  CREATE INDEX ix_resident_profile_name_trgm ON residency.resident_profile USING gin (platform.immutable_unaccent(lower(full_name)) gin_trgm_ops);
  CREATE TABLE notification.device_token (id uuid PRIMARY KEY, token text NOT NULL);
  CREATE TABLE finance.outbox_messages (id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL);
  CREATE TABLE finance.inbox (message_id uuid NOT NULL, handler text NOT NULL, PRIMARY KEY (message_id, handler));
  CREATE SEQUENCE finance.order_code_seq;

`

/** The rows the statements touch, inserted by the superuser first (DOC-19 §9.1). */
export const SEED = `
  INSERT INTO identity.staff_account VALUES ('00000000-0000-7000-8000-000000000001', 'admin@example.invalid', 'admin', 'active', 'argon2id$x');
  INSERT INTO building.building (id, code, name, company, address) VALUES ('00000000-0000-7000-8000-000000000002', 'DEMO-A', '{"vi":"Demo"}', '{"name":{"vi":"Demo"}}', '1 Demo Street');
  INSERT INTO building.gateway_config (id, building_id, provider, driver, secrets_enc, receiving_account, status)
    VALUES ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000002', 'payos', 'fake', 'v1:k1:aa:bb', '{"accountNumber":"123"}', 'active');
  INSERT INTO residency.resident_profile VALUES ('00000000-0000-7000-8000-000000000004', 'Nguyễn Văn An', '1234', 'v1:k1:cccd', '1990-01-01');
  INSERT INTO finance.outbox_messages VALUES ('00000000-0000-7000-8000-000000000005', 'identity.sms_requested.v1', '{"secretEnc": "x"}');
  INSERT INTO audit.audit_log (id, building_id, actor_kind, action, object_type, object_id)
    VALUES ('00000000-0000-7000-8000-000000000006', '00000000-0000-7000-8000-000000000002', 'system', 'x.y.z', 'x', '00000000-0000-7000-8000-000000000002');
  INSERT INTO platform.maintenance (id, active) VALUES (true, false);`
