CREATE TABLE `cron_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`jobName` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` text NOT NULL,
	`error` text
);
