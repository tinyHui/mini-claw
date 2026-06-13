CREATE TABLE `mailbox` (
	`id` text PRIMARY KEY NOT NULL,
	`jobName` text NOT NULL,
	`channel` text DEFAULT 'telegram' NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`send_at` text,
	`fail_reason` text
);
