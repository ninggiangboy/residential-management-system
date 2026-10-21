-- 0001-provision.sql: run once per cluster by a superuser; passwords come from psql variables, never from this file
--   psql -v ON_ERROR_STOP=1 -v db=rms -v app_conn_limit=80 \
--        -v migrator_password="$(cat /etc/rms/secrets/db-migrator-password)" \
--        -v app_password="$(cat /etc/rms/secrets/db-app-password)" \
--        -v readonly_password="$(cat /etc/rms/secrets/db-readonly-password)" -f 0001-provision.sql

CREATE ROLE rms_migrator LOGIN PASSWORD :'migrator_password' CONNECTION LIMIT 3
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_app      LOGIN PASSWORD :'app_password'      CONNECTION LIMIT :app_conn_limit
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_readonly LOGIN PASSWORD :'readonly_password' CONNECTION LIMIT 5
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_backup   LOGIN                               CONNECTION LIMIT 3     -- no password: peer map from the OS user postgres
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- per-role defaults (planned values, confirmed in P1-06 and EXP-07)
ALTER ROLE rms_migrator SET search_path = public;
ALTER ROLE rms_migrator SET lock_timeout = '10s';
ALTER ROLE rms_app SET search_path = public;
ALTER ROLE rms_app SET statement_timeout = '30s';
ALTER ROLE rms_app SET lock_timeout = '10s';
ALTER ROLE rms_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE rms_readonly SET search_path = public;
ALTER ROLE rms_readonly SET default_transaction_read_only = on;
ALTER ROLE rms_readonly SET statement_timeout = '60s';
ALTER ROLE rms_readonly SET idle_in_transaction_session_timeout = '5min';

CREATE DATABASE :"db" OWNER rms_migrator ENCODING 'UTF8';
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO rms_app, rms_readonly, rms_backup;      -- rms_migrator connects as the owner

-- cluster-level grants that only a superuser can make
GRANT pg_monitor TO rms_readonly;                          -- postgres_exporter connects as rms_readonly
GRANT pg_read_all_data TO rms_backup;                      -- pg_dump
GRANT pg_read_all_settings, pg_checkpoint TO rms_backup;   -- pgBackRest (start-fast)

-- function privileges live in the catalog of each database: connect to the application database first
\connect :"db"
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_start(text, boolean) TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_stop(boolean)        TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_switch_wal()                TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_create_restore_point(text)  TO rms_backup;
