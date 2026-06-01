import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  numeric,
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
});

export const absence_types = pgTable("absence_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
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
    hours: numeric("hours", { precision: 4, scale: 2 }),
    comment: text("comment"),
    substitute_employee_id: uuid("substitute_employee_id").references(() => employees.id),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.employee_id, table.date)],
);
