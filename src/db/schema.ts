import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";

// SQLite port of the former pg-core schema. The TypeScript types the rest of the app
// consumes are preserved exactly, so no call site changes:
//   uuid().defaultRandom()          → text().$defaultFn(crypto.randomUUID)
//   pgEnum("user_role", …)          → text({ enum: [...] })
//   timestamp({withTimezone:true})  → integer({ mode: "timestamp" })  (still a `Date` in JS —
//                                     src/pages/dashboard.astro:180-181 compares these as Dates)
//   date()                          → text()   (already 'YYYY-MM-DD' in and out)
//   time()                          → text()   ('HH:MM' / 'HH:MM:SS' strings)
//   boolean()                       → integer({ mode: "boolean" })
//   serial()                        → integer().primaryKey({ autoIncrement: true })

// Local credential store — replaces Supabase's auth.users. Phase 4 drives it.
export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // COLLATE NOCASE gives case-insensitive uniqueness on the address. SQLite's NOCASE is
  // ASCII-only, which is fine for the address forms in use.
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Opaque server-side sessions — the only design that can honour the "log out other
// sessions" promise ChangePasswordDialog.tsx already makes.
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  expires_at: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const employees = sqliteTable("employees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Now a real FK into the local users table (it referenced auth.users under Supabase, which
  // Drizzle could not express). node:sqlite enforces foreign keys by default, so creation and
  // seed order both matter: users before employees.
  user_id: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["employee", "moderator"] }).notNull(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  deleted_at: integer("deleted_at", { mode: "timestamp" }),
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  display_order: integer("display_order").notNull().default(0),
  // Technical-admin marker. App-enforced (there is no RLS to lean on):
  // exactly one row is true; hidden from every user-facing list and immutable via every API path.
  is_system: integer("is_system", { mode: "boolean" }).notNull().default(false),
});

export const absence_types = sqliteTable("absence_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // UNIQUE: src/lib/absence-types.ts gates the partial-day feature on exact name strings,
  // so a duplicate row would silently break it.
  name: text("name").notNull().unique(),
  // DB-level CHECK: color GLOB '#[0-9a-fA-F]…' — not representable in Drizzle; re-add manually
  // after any db:generate diff. (Postgres used `~ '^#[0-9a-fA-F]{6}$'`; SQLite has no regex.)
  color: text("color").notNull(),
  // Presentation metadata. Types stay data, never a name-keyed code map: adding an
  // eighth type is a seed row, not a code change.
  icon: text("icon").notNull().default(""),
  // Explicit foreground so contrast is a catalogue decision, not a luminance guess.
  text_color: text("text_color").notNull().default("#000000"),
  display_order: integer("display_order").notNull().default(0),
});

export const absences = sqliteTable(
  "absences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    employee_id: text("employee_id")
      .notNull()
      .references(() => employees.id),
    absence_type_id: integer("absence_type_id")
      .notNull()
      .references(() => absence_types.id),
    date: text("date").notNull(),
    is_full_day: integer("is_full_day", { mode: "boolean" }).notNull().default(true),
    // DB-level CHECK: absences_time_check — not represented in Drizzle; re-add manually after any db:generate diff
    start_time: text("start_time"),
    end_time: text("end_time"),
    comment: text("comment"),
    // Informational priority marker. Eligibility (only `urlop` / `urlop planowany`) is enforced
    // in application code — src/lib/services/absence-priority.ts — not by a DB constraint:
    // SQLite has no ALTER TABLE ADD CONSTRAINT, and the rule is keyed off absence_types.name.
    // The flag carries no behaviour: no collision resolution, no balance or statistics effect.
    is_priority: integer("is_priority", { mode: "boolean" }).notNull().default(false),
    substitute_employee_id: text("substitute_employee_id").references(() => employees.id),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    // The Postgres AFTER UPDATE trigger is not ported — PATCH /api/absences/:id sets this
    // column explicitly, as bulk.ts and holiday-balances/index.ts already did.
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [unique().on(table.employee_id, table.date)],
);

export const holiday_balances = sqliteTable(
  "holiday_balances",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    employee_id: text("employee_id")
      .notNull()
      .references(() => employees.id),
    year: integer("year").notNull(),
    // Bieżące — current-year statutory entitlement (whole days).
    current_entitlement_days: integer("current_entitlement_days").notNull().default(0),
    // Zaległe — carried-over days from prior years (whole days).
    carryover_days: integer("carryover_days").notNull().default(0),
    // Reconciliation baseline for pre-app usage; keeps Left correct on mid-year adoption.
    used_adjustment_days: integer("used_adjustment_days").notNull().default(0),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // DB-level CHECK constraints (year range; the three day-columns >= 0) are hand-added to the
  // generated migration — Drizzle cannot express them. Re-add manually after any db:generate diff.
  (table) => [unique().on(table.employee_id, table.year)],
);
