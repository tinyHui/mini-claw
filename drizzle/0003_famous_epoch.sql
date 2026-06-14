CREATE TABLE `memory_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` text NOT NULL,
	`target` text NOT NULL,
	`entry` text NOT NULL,
	`rationale` text NOT NULL,
	`evidenceMessageIdsJson` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`appliedAt` text,
	`beforeHash` text,
	`afterHash` text
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `reviewedAt` text;