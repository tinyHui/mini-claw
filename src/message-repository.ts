import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export type MessageStatus = "pending" | "processed";
export type MessageRole = "user" | "assistant" | "system";

export interface Message {
	id: string;
	sessionId: string;
	parentId: string | null;
	timeStamp: string;
	role: MessageRole;
	content: string;
	status: MessageStatus;
}

export type InsertMessageData = Omit<Message, "id" | "timeStamp" | "status"> & {
	id?: string;
	timeStamp?: string;
	status?: MessageStatus;
};

export function insertMessage(data: InsertMessageData): Message {
	const db = getDb();
	const message: Message = {
		id: data.id ?? randomUUID(),
		sessionId: data.sessionId,
		parentId: data.parentId ?? null,
		timeStamp: data.timeStamp ?? new Date().toISOString(),
		role: data.role,
		content: data.content,
		status: data.status ?? "pending",
	};

	db.prepare(`
		INSERT INTO messages (id, sessionId, parentId, timeStamp, role, content, status)
		VALUES (@id, @sessionId, @parentId, @timeStamp, @role, @content, @status)
	`).run(message);

	return message;
}

export function getUnprocessedUserMessages(sessionId?: string): Message[] {
	const db = getDb();
	if (sessionId) {
		return db
			.prepare(
				"SELECT * FROM messages WHERE role = 'user' AND status = 'pending' AND sessionId = ? ORDER BY timeStamp ASC",
			)
			.all(sessionId) as Message[];
	}
	return db
		.prepare(
			"SELECT * FROM messages WHERE role = 'user' AND status = 'pending' ORDER BY timeStamp ASC",
		)
		.all() as Message[];
}

export function markMessageProcessed(
	messageId: string,
	sessionId: string,
): void {
	const db = getDb();
	db.prepare(
		"UPDATE messages SET status = 'processed' WHERE id = ? AND sessionId = ?",
	).run(messageId, sessionId);
}
