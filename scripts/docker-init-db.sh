#!/bin/bash
# Creates the non-superuser application role that owns the database (required for Row-Level Security).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE rental_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
  ALTER DATABASE ${POSTGRES_DB} OWNER TO rental_app;
  GRANT ALL ON SCHEMA public TO rental_app;
  ALTER SCHEMA public OWNER TO rental_app;
SQL
