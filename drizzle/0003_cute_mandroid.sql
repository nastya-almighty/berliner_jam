CREATE TABLE `jam_account_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_by` text,
	FOREIGN KEY (`account_id`) REFERENCES `jam_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `jam_accounts` ADD `email` text;--> statement-breakpoint
ALTER TABLE `jam_accounts` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `jam_accounts` ADD `pending_email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `jam_accounts_email_unique` ON `jam_accounts` (`email`);--> statement-breakpoint
ALTER TABLE `jam_sessions` ADD `recovery_until` integer;