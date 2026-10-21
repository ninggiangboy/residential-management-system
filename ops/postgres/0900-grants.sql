-- 0900-grants.sql: run by rms_migrator after the last module migration of every release (`db:migrate` does it; DOC-19 §4).
-- Idempotent and atomic: it computes the final state from nothing, so a table added by a migration is covered by the next
-- run and a table that was not covered is closed, not open. The exceptions below name objects of modules that may not be
-- migrated yet; each is applied only when its object exists (so the script runs on a database that holds the platform only).
BEGIN;
DO $grants$
DECLARE
  schemas       text[] := ARRAY['identity', 'building', 'residency', 'finance', 'tickets', 'access', 'vehicles',
                                'notices', 'notification', 'wiki', 'audit', 'reporting', 'realtime', 'platform'];
  denied_tables text[] := ARRAY['identity.otp_challenge', 'identity.password_token', 'identity.refresh_family',
                                'identity.refresh_token', 'identity.rate_bucket', 'platform.idempotency_key',
                                'platform.rate_bucket', 'notification.device_token'];
  denied_cols   text[] := ARRAY['residency.resident_profile.date_of_birth'];
  s text;
  r record;
  cols text;
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO rms_app, rms_readonly', s);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM rms_app, rms_readonly', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM rms_app, rms_readonly', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO rms_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO rms_app', s);
  END LOOP;

  -- exceptions of rms_app
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    REVOKE UPDATE, DELETE ON audit.audit_log FROM rms_app;                -- append-only (DR-57)
  END IF;
  REVOKE INSERT, UPDATE, DELETE ON platform.maintenance FROM rms_app;     -- read by every process, written by the deploy script (rms_migrator)
  IF to_regprocedure('audit.purge(timestamptz, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION audit.purge(timestamptz, text) TO rms_app;  -- the monthly purge, clamped inside the function
  END IF;

  -- rms_readonly: SELECT on every table except the denied ones; column-level when a column is sensitive
  FOR r IN
    SELECT n.nspname, c.relname, c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY (schemas)
  LOOP
    IF r.nspname || '.' || r.relname = ANY (denied_tables) OR r.relname = 'outbox_messages' THEN
      CONTINUE;
    END IF;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
      FROM pg_attribute a
     WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname !~ '(_hash|_enc)$'
       AND r.nspname || '.' || r.relname || '.' || a.attname <> ALL (denied_cols);
    IF cols IS NULL THEN
      CONTINUE;                                                            -- every column is excluded: the table stays closed
    END IF;
    IF cols = (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
                 FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('GRANT SELECT ON %I.%I TO rms_readonly', r.nspname, r.relname);
    ELSE
      EXECUTE format('GRANT SELECT (%s) ON %I.%I TO rms_readonly', cols, r.nspname, r.relname);
    END IF;
  END LOOP;
END
$grants$;
COMMIT;
