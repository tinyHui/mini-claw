import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
