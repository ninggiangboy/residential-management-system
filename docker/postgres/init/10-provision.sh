#!/bin/sh
# Runs once, on the first start of an empty data volume (DOC-69 §6): creates the four roles and the database `rms`
# with the same script production uses (DOC-19 §3), so a permission error shows up on the laptop (DR-67).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db=rms -v app_conn_limit=80 \
  -v migrator_password="$RMS_MIGRATOR_PASSWORD" \
  -v app_password="$RMS_APP_PASSWORD" \
  -v readonly_password="$RMS_READONLY_PASSWORD" \
  -f /provision/0001-provision.sql
