CREATE TABLE `jam_admin_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text,
	`revoked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `jam_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `jam_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jam_admin_invites_token_hash_unique` ON `jam_admin_invites` (`token_hash`);