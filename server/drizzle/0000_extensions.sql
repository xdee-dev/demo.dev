-- Extensions required by the schema. All three are "trusted" extensions in PostgreSQL 13+,
-- so a database owner without superuser rights can install them.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
