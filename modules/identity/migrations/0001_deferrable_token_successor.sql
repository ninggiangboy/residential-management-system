-- What drizzle-kit cannot express: the successor of a rotated refresh token is inserted after the consume, so the foreign key is
-- checked at commit (DOC-16 §4.5).
ALTER TABLE identity.refresh_token
  ADD CONSTRAINT fk_refresh_token_replaced_by FOREIGN KEY (replaced_by_id) REFERENCES identity.refresh_token (id)
  DEFERRABLE INITIALLY DEFERRED;
