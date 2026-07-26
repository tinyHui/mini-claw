import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  schedule: text("schedule").notNull(),
  timezone: text("timezone").notNull(),
  profile: text("profile").notNull(),
  nextRun: text("next_run"),
  status: text("status").notNull(),
  missedPolicy: text("missed_policy").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const jobRuns = sqliteTable("job_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  error: text("error")
});

export const sourceItems = sqliteTable("source_items", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  observedAt: text("observed_at").notNull(),
  publishedAt: text("published_at"),
  hash: text("hash").notNull(),
  metadata: text("metadata_json", { mode: "json" }).$type<Record<string, unknown>>().notNull()
}, (table) => [uniqueIndex("source_items_source_external_id").on(table.source, table.externalId)]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  version: integer("version").notNull(),
  markdownPath: text("markdown_path").notNull(),
  sourceStatus: text("source_status_json", { mode: "json" }).$type<unknown[]>().notNull(),
  hash: text("hash").notNull(),
  createdAt: text("created_at").notNull(),
  supersedesId: text("supersedes_id")
}, (table) => [uniqueIndex("reports_period_version").on(table.periodStart, table.periodEnd, table.version)]);

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  platform: text("platform").notNull(),
  account: text("account").notNull(),
  target: text("target"),
  body: text("body").notNull(),
  media: text("media_json", { mode: "json" }).$type<string[]>().notNull(),
  replyParent: text("reply_parent"),
  policyVersion: text("policy_version").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => drafts.id),
  tokenHash: text("token_hash").notNull().unique(),
  contentHash: text("content_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  decision: text("decision"),
  actor: text("actor"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull()
});

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => drafts.id),
  approvalId: text("approval_id").notNull(),
  platform: text("platform").notNull(),
  platformId: text("platform_id"),
  url: text("url"),
  requestHash: text("request_hash").notNull().unique(),
  result: text("result").notNull(),
  rawReference: text("raw_reference"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const connectorHealth = sqliteTable("connector_health", {
  connector: text("connector").primaryKey(),
  checkedAt: text("checked_at").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  result: text("result").notNull(),
  error: text("error")
});

export const watches = sqliteTable("watches", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [uniqueIndex("watches_kind_value").on(table.kind, table.value)]);

export const reportFeedback = sqliteTable("report_feedback", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => reports.id),
  itemKey: text("item_key"),
  decision: text("decision").notNull(),
  createdAt: text("created_at").notNull()
});

export const gatewayOffsets = sqliteTable("gateway_offsets", {
  gateway: text("gateway").primaryKey(),
  offset: text("offset").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  actor: text("actor"),
  subjectId: text("subject_id"),
  details: text("details_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull()
});

export const DraftRowSchema = createSelectSchema(drafts);
export const NewDraftRowSchema = createInsertSchema(drafts);
export const SourceItemRowSchema = createSelectSchema(sourceItems);
export const NewSourceItemRowSchema = createInsertSchema(sourceItems);

export const databaseSchema = {
  jobs, jobRuns, sourceItems, reports, drafts, approvals,
  publications, connectorHealth, watches, reportFeedback, gatewayOffsets, auditEvents
};
