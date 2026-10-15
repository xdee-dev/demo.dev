CREATE TYPE "public"."block_source" AS ENUM('RESERVATION', 'RENTAL', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."cash_account_type" AS ENUM('CASH', 'BANK', 'EWALLET');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'INACTIVE', 'BLACKLISTED');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('INDIVIDUAL', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('BENSIN', 'SOLAR', 'LISTRIK', 'HYBRID', 'LAINNYA');--> statement-breakpoint
CREATE TYPE "public"."import_entity" AS ENUM('CUSTOMER', 'VEHICLE');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('PREVIEW', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('PAYMENT', 'REFUND', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."posting_status" AS ENUM('POSTED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."rental_status" AS ENUM('SCHEDULED', 'ONGOING', 'RETURNED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."rental_type" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('DRAFT', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('MANUAL', 'AUTOMATIC');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "cash_account_type" DEFAULT 'CASH' NOT NULL,
	"bank_name" text,
	"account_number" text,
	"account_holder" text,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"city" text,
	"phone" text,
	"email" text,
	"website" text,
	"npwp" text,
	"bank_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_file_id" uuid,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "customer_type" DEFAULT 'INDIVIDUAL' NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"email" text,
	"address" text,
	"id_type" text,
	"id_number" text,
	"notes" text,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"company_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"period_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_company_id_doc_type_period_key_pk" PRIMARY KEY("company_id","doc_type","period_key")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"license_number" text,
	"daily_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "record_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"expense_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"rental_id" uuid,
	"maintenance_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"proof_file_id" uuid,
	"notes" text,
	"status" "posting_status" DEFAULT 'POSTED' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity" "import_entity" NOT NULL,
	"file_name" text NOT NULL,
	"status" "import_status" DEFAULT 'PREVIEW' NOT NULL,
	"headers" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"mapping" jsonb,
	"duplicate_mode" text,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" "maintenance_status" DEFAULT 'SCHEDULED' NOT NULL,
	"service_type" text NOT NULL,
	"km" integer,
	"workshop" text,
	"cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"next_service_date" date,
	"next_service_km" integer,
	"notes" text,
	"proof_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "maintenance_period_ck" CHECK ("maintenance_records"."end_at" IS NULL OR "maintenance_records"."end_at" > "maintenance_records"."start_at"),
	CONSTRAINT "maintenance_cost_ck" CHECK ("maintenance_records"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "other_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"income_date" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"proof_file_id" uuid,
	"notes" text,
	"status" "posting_status" DEFAULT 'POSTED' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_incomes_amount_ck" CHECK ("other_incomes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "password_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "payment_kind" DEFAULT 'PAYMENT' NOT NULL,
	"is_down_payment" boolean DEFAULT false NOT NULL,
	"rental_id" uuid,
	"reservation_id" uuid,
	"customer_id" uuid NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"reverses_payment_id" uuid,
	"reference" text,
	"notes" text,
	"proof_file_id" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_target_ck" CHECK ("payments"."rental_id" IS NOT NULL OR "payments"."reservation_id" IS NOT NULL),
	CONSTRAINT "payments_sign_ck" CHECK (("payments"."kind" = 'PAYMENT' AND "payments"."amount" > 0) OR ("payments"."kind" = 'REFUND' AND "payments"."amount" < 0) OR ("payments"."kind" = 'REVERSAL' AND "payments"."amount" <> 0 AND "payments"."reverses_payment_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rental_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_number" text NOT NULL,
	"contract_number" text NOT NULL,
	"reservation_id" uuid,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"pickup_location" text,
	"return_location" text,
	"rental_type" "rental_type" NOT NULL,
	"with_driver" boolean DEFAULT false NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"extra_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"extra_charges_note" text,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"daily_rate_snapshot" numeric(18, 2) DEFAULT '0' NOT NULL,
	"late_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"damage_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"cancellation_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "rental_status" DEFAULT 'SCHEDULED' NOT NULL,
	"cancelled_reason" text,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"customer_snapshot" jsonb NOT NULL,
	"vehicle_snapshot" jsonb NOT NULL,
	"company_snapshot" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "rentals_period_ck" CHECK ("rental_transactions"."end_at" > "rental_transactions"."start_at"),
	CONSTRAINT "rentals_amounts_ck" CHECK ("rental_transactions"."subtotal" >= 0 AND "rental_transactions"."discount" >= 0 AND "rental_transactions"."extra_charges" >= 0 AND "rental_transactions"."tax_amount" >= 0 AND "rental_transactions"."late_fee" >= 0 AND "rental_transactions"."damage_fee" >= 0 AND "rental_transactions"."cancellation_fee" >= 0 AND "rental_transactions"."quantity" > 0),
	CONSTRAINT "rentals_total_ck" CHECK ("rental_transactions"."total" = "rental_transactions"."subtotal" - "rental_transactions"."discount" + "rental_transactions"."extra_charges" + "rental_transactions"."late_fee" + "rental_transactions"."damage_fee" + "rental_transactions"."tax_amount" AND "rental_transactions"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"pickup_location" text,
	"return_location" text,
	"rental_type" "rental_type" NOT NULL,
	"with_driver" boolean DEFAULT false NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"extra_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"extra_charges_note" text,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"dp_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"status" "reservation_status" DEFAULT 'DRAFT' NOT NULL,
	"cancelled_reason" text,
	"cancelled_at" timestamp with time zone,
	"rental_id" uuid,
	"customer_snapshot" jsonb NOT NULL,
	"vehicle_snapshot" jsonb NOT NULL,
	"company_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "reservations_period_ck" CHECK ("reservations"."end_at" > "reservations"."start_at"),
	CONSTRAINT "reservations_amounts_ck" CHECK ("reservations"."subtotal" >= 0 AND "reservations"."discount" >= 0 AND "reservations"."extra_charges" >= 0 AND "reservations"."tax_amount" >= 0 AND "reservations"."dp_amount" >= 0 AND "reservations"."quantity" > 0),
	CONSTRAINT "reservations_total_ck" CHECK ("reservations"."total" = "reservations"."subtotal" - "reservations"."discount" + "reservations"."extra_charges" + "reservations"."tax_amount" AND "reservations"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"company_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_company_id_role_permission_pk" PRIMARY KEY("company_id","role","permission")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"handed_at" timestamp with time zone NOT NULL,
	"km" integer,
	"fuel_level" text,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition_notes" text,
	"staff_name" text,
	"receiver_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"rental_type" "rental_type" NOT NULL,
	"with_driver" boolean NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "vehicle_rates_price_ck" CHECK ("vehicle_rates"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"returned_at" timestamp with time zone NOT NULL,
	"km" integer,
	"fuel_level" text,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition_notes" text,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"late_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"damage_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"damage_notes" text,
	"staff_name" text,
	"returner_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"source_type" "block_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"plate_number" text NOT NULL,
	"plate_normalized" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint,
	"color" text,
	"transmission" "transmission" DEFAULT 'MANUAL' NOT NULL,
	"fuel_type" "fuel_type" DEFAULT 'BENSIN' NOT NULL,
	"seats" smallint,
	"chassis_number" text,
	"engine_number" text,
	"purchase_date" date,
	"purchase_price" numeric(18, 2),
	"current_km" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"photo_file_id" uuid,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "vehicles_year_ck" CHECK ("vehicles"."year" IS NULL OR ("vehicles"."year" BETWEEN 1950 AND 2100)),
	CONSTRAINT "vehicles_seats_ck" CHECK ("vehicles"."seats" IS NULL OR ("vehicles"."seats" BETWEEN 1 AND 100))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rental_id_rental_transactions_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rental_id_rental_transactions_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_rental_id_rental_transactions_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_rates" ADD CONSTRAINT "vehicle_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_rates" ADD CONSTRAINT "vehicle_rates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_rates" ADD CONSTRAINT "vehicle_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_returns" ADD CONSTRAINT "vehicle_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_returns" ADD CONSTRAINT "vehicle_returns_rental_id_rental_transactions_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_returns" ADD CONSTRAINT "vehicle_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_schedule_blocks" ADD CONSTRAINT "vehicle_schedule_blocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_schedule_blocks" ADD CONSTRAINT "vehicle_schedule_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_company_created_idx" ON "audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_accounts_company_name_uq" ON "cash_accounts" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "company_memberships_company_user_uq" ON "company_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_user_idx" ON "company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_uq" ON "customers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "customers_company_phone_idx" ON "customers" USING btree ("company_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "customers_company_idnum_idx" ON "customers" USING btree ("company_id","id_number");--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_company_code_uq" ON "drivers" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_company_code_uq" ON "expense_categories" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_number_uq" ON "expenses" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_idem_uq" ON "expenses" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_maintenance_uq" ON "expenses" USING btree ("maintenance_id");--> statement-breakpoint
CREATE INDEX "expenses_company_date_idx" ON "expenses" USING btree ("company_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_vehicle_idx" ON "expenses" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "file_attachments_entity_idx" ON "file_attachments" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "import_jobs_company_idx" ON "import_jobs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_company_number_uq" ON "maintenance_records" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "maintenance_vehicle_idx" ON "maintenance_records" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "maintenance_company_start_idx" ON "maintenance_records" USING btree ("company_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "other_incomes_company_number_uq" ON "other_incomes" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "other_incomes_company_idem_uq" ON "other_incomes" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "other_incomes_company_date_idx" ON "other_incomes" USING btree ("company_id","income_date");--> statement-breakpoint
CREATE INDEX "password_tokens_user_idx" ON "password_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_company_number_uq" ON "payments" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_company_idem_uq" ON "payments" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reverses_uq" ON "payments" USING btree ("reverses_payment_id");--> statement-breakpoint
CREATE INDEX "payments_company_paid_idx" ON "payments" USING btree ("company_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_rental_idx" ON "payments" USING btree ("rental_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_company_number_uq" ON "rental_transactions" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_company_invoice_uq" ON "rental_transactions" USING btree ("company_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_company_contract_uq" ON "rental_transactions" USING btree ("company_id","contract_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_reservation_uq" ON "rental_transactions" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_company_idem_uq" ON "rental_transactions" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "rentals_company_start_idx" ON "rental_transactions" USING btree ("company_id","start_at");--> statement-breakpoint
CREATE INDEX "rentals_company_status_idx" ON "rental_transactions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "rentals_customer_idx" ON "rental_transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "rentals_vehicle_idx" ON "rental_transactions" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_company_number_uq" ON "reservations" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "reservations_company_start_idx" ON "reservations" USING btree ("company_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_customer_idx" ON "reservations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_handovers_rental_uq" ON "vehicle_handovers" USING btree ("rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_rates_uq" ON "vehicle_rates" USING btree ("vehicle_id","rental_type","with_driver");--> statement-breakpoint
CREATE INDEX "vehicle_rates_company_idx" ON "vehicle_rates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_returns_rental_uq" ON "vehicle_returns" USING btree ("rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_schedule_blocks_source_uq" ON "vehicle_schedule_blocks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "vehicle_schedule_blocks_company_idx" ON "vehicle_schedule_blocks" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_company_code_uq" ON "vehicles" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_company_plate_uq" ON "vehicles" USING btree ("company_id","plate_normalized");