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
  CREATE TABLE building.building (id uuid PRIMARY KEY, name text NOT NULL);
  CREATE TABLE building.building_setting (id uuid PRIMARY KEY, building_id uuid NOT NULL);
  CREATE TABLE building.gateway_config (id uuid PRIMARY KEY, provider text NOT NULL, driver text NOT NULL, receiving_account text, status text NOT NULL, secrets_enc text);
  CREATE TABLE building.file_object (id uuid PRIMARY KEY, size bigint NOT NULL);
  CREATE TABLE building.terms_version (id uuid PRIMARY KEY, kind text NOT NULL);
  CREATE TABLE residency.resident_profile (id uuid PRIMARY KEY, full_name text NOT NULL, cccd_last4 text, cccd_enc text, date_of_birth date);
  CREATE INDEX ix_resident_profile_name_trgm ON residency.resident_profile USING gin (platform.immutable_unaccent(lower(full_name)) gin_trgm_ops);
  CREATE TABLE notification.device_token (id uuid PRIMARY KEY, token text NOT NULL);
  CREATE TABLE finance.outbox_messages (id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL);
  CREATE TABLE finance.inbox (message_id uuid NOT NULL, handler text NOT NULL, PRIMARY KEY (message_id, handler));
  CREATE SEQUENCE finance.order_code_seq;

  CREATE TABLE audit.audit_log (id uuid PRIMARY KEY, action text NOT NULL);
  CREATE FUNCTION audit.audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '23000'; END $$;
  CREATE TRIGGER trg_audit_log_append_only BEFORE UPDATE OR DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION audit.audit_log_append_only();
  CREATE FUNCTION audit.purge(cutoff timestamptz, tier text) RETURNS bigint LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, audit AS $$ SELECT 0::bigint $$;
  REVOKE ALL ON FUNCTION audit.purge(timestamptz, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION audit.purge(timestamptz, text) TO rms_migrator;

  CREATE FUNCTION building.terms_version_freeze() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER trg_terms_version_freeze BEFORE UPDATE ON building.terms_version FOR EACH ROW EXECUTE FUNCTION building.terms_version_freeze();`

/** The rows the statements touch, inserted by the superuser first (DOC-19 §9.1). */
export const SEED = `
  INSERT INTO identity.staff_account VALUES ('00000000-0000-7000-8000-000000000001', 'admin@example.invalid', 'admin', 'active', 'argon2id$x');
  INSERT INTO building.building VALUES ('00000000-0000-7000-8000-000000000002', 'Demo');
  INSERT INTO building.gateway_config VALUES ('00000000-0000-7000-8000-000000000003', 'payos', 'fake', '123', 'active', 'v1:k1:secret');
  INSERT INTO residency.resident_profile VALUES ('00000000-0000-7000-8000-000000000004', 'Nguyễn Văn An', '1234', 'v1:k1:cccd', '1990-01-01');
  INSERT INTO finance.outbox_messages VALUES ('00000000-0000-7000-8000-000000000005', 'identity.sms_requested.v1', '{"secretEnc": "x"}');
  INSERT INTO audit.audit_log VALUES ('00000000-0000-7000-8000-000000000006', 'x');
  INSERT INTO platform.maintenance (id, active) VALUES (true, false);`
