CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `schedule` text NOT NULL,
  `timezone` text NOT NULL,
  `profile` text NOT NULL,
  `next_run` text,
  `status` text NOT NULL,
  `missed_policy` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`),
  `started_at` text NOT NULL,
  `finished_at` text,
  `status` text NOT NULL,
  `error` text
);
--> statement-breakpoint
CREATE TABLE `source_items` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `external_id` text NOT NULL,
  `url` text NOT NULL,
  `title` text NOT NULL,
  `observed_at` text NOT NULL,
  `published_at` text,
  `hash` text NOT NULL,
  `metadata_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_items_source_external_id` ON `source_items` (`source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `reports` (
  `id` text PRIMARY KEY NOT NULL,
  `period_start` text NOT NULL,
  `period_end` text NOT NULL,
  `version` integer NOT NULL,
  `markdown_path` text NOT NULL,
  `source_status_json` text NOT NULL,
  `hash` text NOT NULL,
  `created_at` text NOT NULL,
  `supersedes_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_period_version` ON `reports` (`period_start`,`period_end`,`version`);
--> statement-breakpoint
CREATE TABLE `drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `version` integer NOT NULL,
  `platform` text NOT NULL,
  `account` text NOT NULL,
  `target` text,
  `body` text NOT NULL,
  `media_json` text NOT NULL,
  `reply_parent` text,
  `policy_version` text NOT NULL,
  `content_hash` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `drafts`(`id`),
  `token_hash` text NOT NULL UNIQUE,
  `content_hash` text NOT NULL,
  `expires_at` text NOT NULL,
  `decision` text,
  `actor` text,
  `decided_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `drafts`(`id`),
  `approval_id` text NOT NULL,
  `platform` text NOT NULL,
  `platform_id` text,
  `url` text,
  `request_hash` text NOT NULL UNIQUE,
  `result` text NOT NULL,
  `raw_reference` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_health` (
  `connector` text PRIMARY KEY NOT NULL,
  `checked_at` text NOT NULL,
  `latency_ms` integer NOT NULL,
  `result` text NOT NULL,
  `error` text
);
--> statement-breakpoint
CREATE TABLE `watches` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `enabled` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watches_kind_value` ON `watches` (`kind`,`value`);
--> statement-breakpoint
CREATE TABLE `report_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `report_id` text NOT NULL REFERENCES `reports`(`id`),
  `item_key` text,
  `decision` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gateway_offsets` (
  `gateway` text PRIMARY KEY NOT NULL,
  `offset` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `actor` text,
  `subject_id` text,
  `details_json` text NOT NULL,
  `created_at` text NOT NULL
);
