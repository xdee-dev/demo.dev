-- =====================================================================================
-- Tenant isolation, integrity constraints, triggers and views that drizzle-kit cannot
-- express. Hand-written; keep idempotent where practical.
-- =====================================================================================

-- ---------------------------------------------------------------- tenant context
-- The API sets `app.company_id` with set_config(..., true) at the start of every request
-- transaction. When the setting is missing the function returns NULL and RLS policies match
-- nothing, so a forgotten context fails closed (no rows) instead of leaking data.
CREATE OR REPLACE FUNCTION app_current_company() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'role_permissions','company_settings','document_sequences','file_attachments','cash_accounts',
    'expense_categories','customers','vehicles','vehicle_rates','drivers','reservations',
    'rental_transactions','vehicle_handovers','vehicle_returns','vehicle_schedule_blocks','payments',
    'expenses','other_incomes','maintenance_records','import_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Audit log: tenant rows are visible only inside their company; platform rows (company_id NULL,
-- e.g. super-admin actions and logins) only when the request explicitly runs in platform mode.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_isolation ON audit_logs
  USING (company_id = app_current_company() OR (company_id IS NULL AND current_setting('app.platform', true) = 'on'))
  WITH CHECK (company_id = app_current_company() OR (company_id IS NULL AND current_setting('app.platform', true) = 'on'));
--> statement-breakpoint

-- ---------------------------------------------------------------- same-company foreign keys
-- Regular FK checks bypass RLS, so a crafted request could otherwise point at another
-- company's row by UUID. Composite (company_id, id) foreign keys make that impossible.
ALTER TABLE customers ADD CONSTRAINT customers_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE vehicles ADD CONSTRAINT vehicles_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE drivers ADD CONSTRAINT drivers_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE reservations ADD CONSTRAINT reservations_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE rental_transactions ADD CONSTRAINT rentals_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE maintenance_records ADD CONSTRAINT maintenance_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_company_id_id_uq UNIQUE (company_id, id);
--> statement-breakpoint

ALTER TABLE vehicle_rates ADD CONSTRAINT vehicle_rates_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE reservations ADD CONSTRAINT reservations_customer_cfk FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id);
--> statement-breakpoint
ALTER TABLE reservations ADD CONSTRAINT reservations_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE reservations ADD CONSTRAINT reservations_driver_cfk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id);
--> statement-breakpoint
ALTER TABLE reservations ADD CONSTRAINT reservations_rental_cfk FOREIGN KEY (company_id, rental_id) REFERENCES rental_transactions (company_id, id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE rental_transactions ADD CONSTRAINT rentals_customer_cfk FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id);
--> statement-breakpoint
ALTER TABLE rental_transactions ADD CONSTRAINT rentals_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE rental_transactions ADD CONSTRAINT rentals_driver_cfk FOREIGN KEY (company_id, driver_id) REFERENCES drivers (company_id, id);
--> statement-breakpoint
ALTER TABLE rental_transactions ADD CONSTRAINT rentals_reservation_cfk FOREIGN KEY (company_id, reservation_id) REFERENCES reservations (company_id, id);
--> statement-breakpoint
ALTER TABLE vehicle_handovers ADD CONSTRAINT handovers_rental_cfk FOREIGN KEY (company_id, rental_id) REFERENCES rental_transactions (company_id, id);
--> statement-breakpoint
ALTER TABLE vehicle_returns ADD CONSTRAINT returns_rental_cfk FOREIGN KEY (company_id, rental_id) REFERENCES rental_transactions (company_id, id);
--> statement-breakpoint
ALTER TABLE vehicle_schedule_blocks ADD CONSTRAINT blocks_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_rental_cfk FOREIGN KEY (company_id, rental_id) REFERENCES rental_transactions (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_reservation_cfk FOREIGN KEY (company_id, reservation_id) REFERENCES reservations (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_customer_cfk FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_cash_account_cfk FOREIGN KEY (company_id, cash_account_id) REFERENCES cash_accounts (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_reverses_cfk FOREIGN KEY (company_id, reverses_payment_id) REFERENCES payments (company_id, id);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_proof_cfk FOREIGN KEY (company_id, proof_file_id) REFERENCES file_attachments (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_category_cfk FOREIGN KEY (company_id, category_id) REFERENCES expense_categories (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_rental_cfk FOREIGN KEY (company_id, rental_id) REFERENCES rental_transactions (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_maintenance_cfk FOREIGN KEY (company_id, maintenance_id) REFERENCES maintenance_records (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_cash_account_cfk FOREIGN KEY (company_id, cash_account_id) REFERENCES cash_accounts (company_id, id);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_proof_cfk FOREIGN KEY (company_id, proof_file_id) REFERENCES file_attachments (company_id, id);
--> statement-breakpoint
ALTER TABLE other_incomes ADD CONSTRAINT other_incomes_cash_account_cfk FOREIGN KEY (company_id, cash_account_id) REFERENCES cash_accounts (company_id, id);
--> statement-breakpoint
ALTER TABLE other_incomes ADD CONSTRAINT other_incomes_proof_cfk FOREIGN KEY (company_id, proof_file_id) REFERENCES file_attachments (company_id, id);
--> statement-breakpoint
ALTER TABLE maintenance_records ADD CONSTRAINT maintenance_vehicle_cfk FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles (company_id, id);
--> statement-breakpoint
ALTER TABLE maintenance_records ADD CONSTRAINT maintenance_proof_cfk FOREIGN KEY (company_id, proof_file_id) REFERENCES file_attachments (company_id, id);
--> statement-breakpoint
ALTER TABLE vehicles ADD CONSTRAINT vehicles_photo_cfk FOREIGN KEY (company_id, photo_file_id) REFERENCES file_attachments (company_id, id);
--> statement-breakpoint

-- ---------------------------------------------------------------- schedule conflicts
-- The heart of double-booking prevention: two active blocks of the same vehicle can never
-- overlap. Enforced by PostgreSQL itself, so concurrent requests cannot both succeed.
ALTER TABLE vehicle_schedule_blocks ADD CONSTRAINT vehicle_schedule_period_ck CHECK (NOT isempty(period));
--> statement-breakpoint
ALTER TABLE vehicle_schedule_blocks ADD CONSTRAINT vehicle_schedule_no_overlap
  EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active);
--> statement-breakpoint
CREATE INDEX vehicle_schedule_blocks_period_idx ON vehicle_schedule_blocks USING gist (company_id, period) WHERE active;
--> statement-breakpoint

-- ---------------------------------------------------------------- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','users','company_memberships','company_settings','cash_accounts','customers','vehicles',
    'vehicle_rates','drivers','reservations','rental_transactions','vehicle_schedule_blocks','expenses',
    'other_incomes','maintenance_records'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- financial immutability
-- Posted payments are never deleted or silently edited. Corrections are new REVERSAL rows.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted; post a reversal instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.method IS DISTINCT FROM OLD.method OR NEW.cash_account_id IS DISTINCT FROM OLD.cash_account_id
     OR NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR (OLD.rental_id IS NOT NULL AND NEW.rental_id IS DISTINCT FROM OLD.rental_id) THEN
    RAISE EXCEPTION 'Posted payments are immutable; post a reversal instead' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted; void them instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'Voided % rows cannot be modified', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expenses_guard BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION posting_guard();
--> statement-breakpoint
CREATE TRIGGER other_incomes_guard BEFORE UPDATE OR DELETE ON other_incomes FOR EACH ROW EXECUTE FUNCTION posting_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION no_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER rentals_no_delete BEFORE DELETE ON rental_transactions FOR EACH ROW EXECUTE FUNCTION no_delete_guard();
--> statement-breakpoint
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON reservations FOR EACH ROW EXECUTE FUNCTION no_delete_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------- payment status
-- Single SQL definition of payment status (mirrored and unit-tested in src/lib/money.ts).
CREATE OR REPLACE FUNCTION payment_status(due numeric, paid numeric, non_dp_count bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN paid > due THEN 'REFUND_DUE'
    WHEN paid >= due THEN 'PAID'
    WHEN paid <= 0 THEN 'UNPAID'
    WHEN non_dp_count = 0 THEN 'DP_PAID'
    ELSE 'PARTIAL'
  END
$$;
--> statement-breakpoint

-- security_invoker => the caller's RLS policies apply inside the view.
CREATE VIEW rental_balances WITH (security_invoker = true) AS
SELECT
  r.id AS rental_id,
  r.company_id,
  (CASE WHEN r.status = 'CANCELLED' THEN r.cancellation_fee ELSE r.total END) AS amount_due,
  COALESCE(p.paid, 0)::numeric(18,2) AS paid,
  ((CASE WHEN r.status = 'CANCELLED' THEN r.cancellation_fee ELSE r.total END) - COALESCE(p.paid, 0))::numeric(18,2) AS balance,
  payment_status(
    (CASE WHEN r.status = 'CANCELLED' THEN r.cancellation_fee ELSE r.total END),
    COALESCE(p.paid, 0),
    COALESCE(p.non_dp_count, 0)
  ) AS payment_status,
  p.last_paid_at
FROM rental_transactions r
LEFT JOIN LATERAL (
  SELECT
    SUM(x.amount) AS paid,
    COUNT(*) FILTER (
      WHERE x.kind = 'PAYMENT' AND NOT x.is_down_payment
        AND NOT EXISTS (SELECT 1 FROM payments rv WHERE rv.reverses_payment_id = x.id)
    ) AS non_dp_count,
    MAX(x.paid_at) AS last_paid_at
  FROM payments x
  WHERE x.rental_id = r.id
) p ON true;
--> statement-breakpoint

CREATE VIEW reservation_balances WITH (security_invoker = true) AS
SELECT
  rs.id AS reservation_id,
  rs.company_id,
  (CASE WHEN rs.status = 'CANCELLED' THEN 0 ELSE rs.total END)::numeric(18,2) AS amount_due,
  COALESCE(p.paid, 0)::numeric(18,2) AS paid,
  ((CASE WHEN rs.status = 'CANCELLED' THEN 0 ELSE rs.total END) - COALESCE(p.paid, 0))::numeric(18,2) AS balance
FROM reservations rs
LEFT JOIN LATERAL (
  SELECT SUM(x.amount) AS paid FROM payments x WHERE x.reservation_id = rs.id
) p ON true;
