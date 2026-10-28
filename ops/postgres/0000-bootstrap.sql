-- 0000-bootstrap.sql: run by rms_migrator at the start of every `db:migrate`, before any module migration (DOC-14 §2.2,
-- DOC-19 §3.1 step 2). Idempotent: every object is created only when it is missing, so a second run changes nothing.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS building;
CREATE SCHEMA IF NOT EXISTS residency;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS tickets;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS vehicles;
CREATE SCHEMA IF NOT EXISTS notices;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS wiki;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS analytics;

-- Shared helpers (they belong to platform, i.e. to the core packages)
CREATE OR REPLACE FUNCTION platform.immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION platform.is_bilingual(v jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT coalesce(
         jsonb_typeof(v) = 'object'
         AND jsonb_typeof(v -> 'vi') = 'string' AND btrim(v ->> 'vi') <> ''
         AND (v -> 'en' IS NULL OR jsonb_typeof(v -> 'en') = 'string')
         AND (v - 'vi' - 'en') = '{}'::jsonb,
       false)   -- a CHECK passes on NULL: the coalesce makes "vi missing" fail
  $$;

-- The tables of platform (DOC-17 §3.4): they must exist before and while the migrations run.

-- One row by construction. Only rms_migrator writes it (the deploy script); every process polls it.
CREATE TABLE IF NOT EXISTS platform.maintenance (
  id     boolean     PRIMARY KEY DEFAULT true CHECK (id),
  active boolean     NOT NULL DEFAULT false,
  reason text,
  since  timestamptz
);

CREATE TABLE IF NOT EXISTS platform.idempotency_key (
  account_kind    text        NOT NULL,
  account_id      uuid        NOT NULL,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'in_progress',
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_idempotency_key PRIMARY KEY (account_kind, account_id, key),
  CONSTRAINT ck_idempotency_key_kind     CHECK (account_kind IN ('staff', 'resident')),
  CONSTRAINT ck_idempotency_key_key      CHECK (char_length(key) BETWEEN 8 AND 128),
  CONSTRAINT ck_idempotency_key_hash     CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_idempotency_key_status   CHECK (status IN ('in_progress', 'completed')),
  CONSTRAINT ck_idempotency_key_response CHECK ((status = 'completed') = (response_status IS NOT NULL)),
  CONSTRAINT ck_idempotency_key_http     CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599)
);
CREATE INDEX IF NOT EXISTS ix_idempotency_key_created ON platform.idempotency_key (created_at);

CREATE TABLE IF NOT EXISTS platform.rate_bucket (
  key        text             PRIMARY KEY,
  tokens     double precision NOT NULL,
  updated_at timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rate_bucket_updated ON platform.rate_bucket (updated_at);
