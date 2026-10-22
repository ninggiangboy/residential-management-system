-- What drizzle-kit cannot express (DOC-14 §14.2: hand-written SQL is allowed for it).

-- The quota (DOC-37 §11): `SELECT coalesce(sum(size), 0) … WHERE building_id = :b AND status <> 'deleted'`, hourly and at every
-- register. A covering partial index, so the sum is index-only after a VACUUM.
CREATE INDEX ix_file_object_building_live ON building.file_object (building_id) INCLUDE (size) WHERE status <> 'deleted';
--> statement-breakpoint
-- The text people accepted must never change: a correction is a new version (DOC-17 §1.4).
CREATE FUNCTION building.terms_version_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'terms_version % is write-once', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_terms_version_freeze BEFORE UPDATE ON building.terms_version
  FOR EACH ROW EXECUTE FUNCTION building.terms_version_freeze();
