#!/bin/sh
# Creates the OmniTrack database roles (DATABASE.md §3) and databases.
# Runs once, on first start of an empty postgres data volume. Passwords come from the environment.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE omnitrack_migrator LOGIN CREATEDB PASSWORD '${OMNITRACK_MIGRATOR_PASSWORD}';
CREATE ROLE omnitrack_app      LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${OMNITRACK_APP_PASSWORD}';
CREATE ROLE omnitrack_worker   LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${OMNITRACK_WORKER_PASSWORD}';
CREATE DATABASE omnitrack      OWNER omnitrack_migrator;
CREATE DATABASE omnitrack_test OWNER omnitrack_migrator;
SQL

for db in omnitrack omnitrack_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO omnitrack_migrator;
GRANT USAGE ON SCHEMA public TO omnitrack_app, omnitrack_worker;
SQL
done
