-- DOC-17 §2: the log is append-only in two layers (DR-57). The control is privilege (`rms_app` holds SELECT and INSERT only,
-- granted by ops/postgres/0900-grants.sql); the trigger is a seatbelt against a migration or a mistaken grant, not a boundary.
CREATE FUNCTION audit.audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('audit.purging', true) = 'on' THEN
    RETURN OLD;                                        -- only audit.purge sets the flag, transaction-locally
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_audit_log_append_only BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_audit_log_no_truncate BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.audit_log_append_only();
--> statement-breakpoint
-- The purge is the only deleter. It is SECURITY DEFINER, so it deletes with the owner's rights, and it clamps the cut-off to
-- the retention floor, so a compromised `rms_app` cannot ask for more than the policy allows (DR-110).
CREATE FUNCTION audit.purge(p_before timestamptz, p_scope text) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit
  AS $$
DECLARE
  v_floor  interval;
  v_cutoff timestamptz;
  v_rows   bigint;
BEGIN
  IF p_scope NOT IN ('finance', 'standard') THEN
    RAISE EXCEPTION 'unknown audit scope %', p_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_floor  := CASE p_scope WHEN 'finance' THEN interval '5 years' ELSE interval '2 years' END;
  v_cutoff := least(p_before, now() - v_floor);          -- the caller can only ask for less than the floor allows
  PERFORM set_config('audit.purging', 'on', true);       -- transaction-local
  DELETE FROM audit.audit_log WHERE retention_class = p_scope AND at < v_cutoff;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit.purge(timestamptz, text) FROM PUBLIC;
