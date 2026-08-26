-- =============================================================================
-- Baseline schema (sqlite-install p1)
--
-- drizzle-kit generated the CREATE TABLEs and indexes; the CHECK constraints and the
-- `COLLATE NOCASE` on users.email are hand-added, because Drizzle cannot express either.
-- SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so unlike the Postgres baseline these
-- cannot be appended as separate statements — they live inside CREATE TABLE, and a
-- regenerated table definition drops them silently. Re-add after any db:generate diff.
--
-- Postgres originals, for reference:
--   absence_types_color_check          color ~ '^#[0-9a-fA-F]{6}$'   (no regex in SQLite → GLOB)
--   absences_time_check                20260605000001_absence_start_end_time.sql:31-37
--   holiday_balances_year_check        20260713124938_premium_brother_voodoo.sql
--   holiday_balances_days_nonnegative_check
-- =============================================================================
CREATE TABLE `absence_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`text_color` text DEFAULT '#000000' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `absence_types_color_check` CHECK (`color` GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absence_types_name_unique` ON `absence_types` (`name`);--> statement-breakpoint
CREATE TABLE `absences` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`absence_type_id` integer NOT NULL,
	`date` text NOT NULL,
	`is_full_day` integer DEFAULT true NOT NULL,
	`start_time` text,
	`end_time` text,
	`comment` text,
	`substitute_employee_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`absence_type_id`) REFERENCES `absence_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`substitute_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `absences_time_check` CHECK (
		(`is_full_day` AND `start_time` IS NULL AND `end_time` IS NULL)
		OR
		(NOT `is_full_day` AND `start_time` IS NOT NULL AND `end_time` IS NOT NULL AND `end_time` > `start_time`)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absences_employee_id_date_unique` ON `absences` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_user_id_unique` ON `employees` (`user_id`);--> statement-breakpoint
CREATE TABLE `holiday_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`year` integer NOT NULL,
	`current_entitlement_days` integer DEFAULT 0 NOT NULL,
	`carryover_days` integer DEFAULT 0 NOT NULL,
	`used_adjustment_days` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `holiday_balances_year_check` CHECK (`year` >= 2000 AND `year` <= 2100),
	CONSTRAINT `holiday_balances_days_nonnegative_check` CHECK (`current_entitlement_days` >= 0 AND `carryover_days` >= 0 AND `used_adjustment_days` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_balances_employee_id_year_unique` ON `holiday_balances` (`employee_id`,`year`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL COLLATE NOCASE,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);