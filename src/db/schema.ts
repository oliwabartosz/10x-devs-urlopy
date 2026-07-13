import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  time,
  boolean,
  integer,
  serial,
  unique,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["employee", "moderator"]);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique(),
  role: userRoleEnum("role").notNull(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  display_order: integer("display_order").notNull().default(0),
  // Technical-admin marker. App-enforced (RLS is bypassed on the service-role connection):
  // exactly one row is true; hidden from every user-facing list and immutable via every API path.
  is_system: boolean("is_system").notNull().default(false),
});

export const absence_types = pgTable("absence_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // DB-level CHECK: color ~ '^#[0-9a-fA-F]{6}$' — not represented in Drizzle; re-add manually after any db:generate diff
  color: text("color").notNull(),
});

export const absences = pgTable(
  "absences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employee_id: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    absence_type_id: integer("absence_type_id")
      .notNull()
      .references(() => absence_types.id),
    date: date("date").notNull(),
    is_full_day: boolean("is_full_day").notNull().default(true),
    // DB-level CHECK: absences_time_check — not represented in Drizzle; re-add manually after any db:generate diff
    start_time: time("start_time"),
    end_time: time("end_time"),
    comment: text("comment"),
    substitute_employee_id: uuid("substitute_employee_id").references(() => employees.id),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // DB sets this via DEFAULT NOW() + AFTER UPDATE trigger; .defaultNow() here covers $inferInsert type correctness
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.employee_id, table.date)],
);

export const holiday_balances = pgTable(
  "holiday_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employee_id: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    year: integer("year").notNull(),
    // Bieżące — current-year statutory entitlement (whole days).
    current_entitlement_days: integer("current_entitlement_days").notNull().default(0),
    // Zaległe — carried-over days from prior years (whole days).
    carryover_days: integer("carryover_days").notNull().default(0),
    // Reconciliation baseline for pre-app usage; keeps Left correct on mid-year adoption.
    used_adjustment_days: integer("used_adjustment_days").notNull().default(0),
    // "Do dnia" — informational HR provenance date; nullable.
    valid_until: date("valid_until"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // DB-level CHECK constraints (year range; the three day-columns >= 0) are hand-added to the
  // generated migration — Drizzle cannot express them. Re-add manually after any db:generate diff.
  (table) => [unique().on(table.employee_id, table.year)],
);
