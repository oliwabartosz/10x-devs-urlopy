CREATE TABLE "holiday_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"current_entitlement_days" integer DEFAULT 0 NOT NULL,
	"carryover_days" integer DEFAULT 0 NOT NULL,
	"used_adjustment_days" integer DEFAULT 0 NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_balances_employee_id_year_unique" UNIQUE("employee_id","year")
);
--> statement-breakpoint
ALTER TABLE "holiday_balances" ADD CONSTRAINT "holiday_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- DB-level CHECK constraints not representable in the Drizzle schema — hand-added per
-- migration discipline (AGENTS.md). Re-add after any future db:generate diff on this table.
ALTER TABLE "holiday_balances" ADD CONSTRAINT "holiday_balances_year_check"
  CHECK ("year" >= 2000 AND "year" <= 2100);--> statement-breakpoint
ALTER TABLE "holiday_balances" ADD CONSTRAINT "holiday_balances_days_nonnegative_check"
  CHECK ("current_entitlement_days" >= 0 AND "carryover_days" >= 0 AND "used_adjustment_days" >= 0);