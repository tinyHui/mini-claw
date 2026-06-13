import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey().notNull(),
	createdAt: text("createdAt").notNull(),
	model: text("model").notNull(),
	thinkingLevel: text("thinkingLevel").notNull(),
});

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").notNull(),
		sessionId: text("sessionId")
			.notNull()
			.references(() => sessions.id),
		timeStamp: text("timeStamp").notNull(),
		role: text("role").notNull(),
		content: text("content").notNull(),
		status: text("status").notNull().default("pending"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.id, table.sessionId] }),
	}),
);

export const cronJobs = sqliteTable("cron_jobs", {
	name: text("name").primaryKey().notNull(),
	description: text("description").notNull(),
	cronExpression: text("cronExpression").notNull(),
	enabled: integer("enabled").notNull().default(1),
	hasSeconds: integer("hasSeconds").notNull().default(0),
	scriptPath: text("scriptPath").notNull(),
	schedulePath: text("schedulePath").notNull(),
	contentHash: text("contentHash").notNull(),
	validatedAt: text("validatedAt").notNull(),
});

export const cronCapabilities = sqliteTable("cron_capabilities", {
	slug: text("slug").primaryKey().notNull(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	manifestPath: text("manifestPath").notNull(),
	entrypointPath: text("entrypointPath").notNull(),
	inputSchemaJson: text("inputSchemaJson").notNull(),
	outputSchemaJson: text("outputSchemaJson").notNull(),
	contentHash: text("contentHash").notNull(),
	validatedAt: text("validatedAt").notNull(),
});

export const mailbox = sqliteTable("mailbox", {
	id: text("id").primaryKey().notNull(),
	jobName: text("jobName").notNull(),
	channel: text("channel").notNull().default("telegram"),
	content: text("content").notNull(),
	createdAt: text("created_at").notNull(),
	sendAt: text("send_at"),
	failReason: text("fail_reason"),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type CronJobRow = typeof cronJobs.$inferSelect;
export type NewCronJobRow = typeof cronJobs.$inferInsert;
export type CronCapabilityRow = typeof cronCapabilities.$inferSelect;
export type NewCronCapabilityRow = typeof cronCapabilities.$inferInsert;
export type MailboxRow = typeof mailbox.$inferSelect;
export type NewMailboxRow = typeof mailbox.$inferInsert;
