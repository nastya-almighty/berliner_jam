CREATE TABLE `jam_auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jam_auth_claims` (
	`key` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `jam_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jam_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`access_hash` text,
	`login` text,
	`password_hash` text,
	`salt` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jam_accounts_access_hash_unique` ON `jam_accounts` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `jam_accounts_login_unique` ON `jam_accounts` (`login`);--> statement-breakpoint
CREATE TABLE `jam_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `jam_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
