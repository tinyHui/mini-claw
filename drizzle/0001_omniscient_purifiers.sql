CREATE TABLE `cron_capabilities` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`manifestPath` text NOT NULL,
	`entrypointPath` text NOT NULL,
	`inputSchemaJson` text NOT NULL,
	`outputSchemaJson` text NOT NULL,
	`contentHash` text NOT NULL,
	`validatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cron_jobs` (
	`name` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`cronExpression` text NOT NULL,
	`hasSeconds` integer DEFAULT 0 NOT NULL,
	`scriptPath` text NOT NULL,
	`schedulePath` text NOT NULL,
	`contentHash` text NOT NULL,
	`validatedAt` text NOT NULL
);
