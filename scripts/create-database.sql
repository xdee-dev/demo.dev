-- Run ONCE as the PostgreSQL superuser (e.g. "postgres") in psql or pgAdmin's Query Tool:
--   psql -U postgres -f scripts/create-database.sql
-- Then put the same password in DATABASE_URL in your .env file.
-- The application role is deliberately NOT a superuser: superusers bypass Row-Level Security.

CREATE ROLE rental_app LOGIN PASSWORD 'GANTI_PASSWORD_INI' NOSUPERUSER NOCREATEROLE NOBYPASSRLS CREATEDB;
CREATE DATABASE rental_db OWNER rental_app ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE rental_test OWNER rental_app ENCODING 'UTF8' TEMPLATE template0;  -- for automated tests (optional)
