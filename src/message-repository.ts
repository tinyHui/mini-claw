import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

// 'pending'   – user message waiting to be picked up by the AI processor
// 'processed' – user message that has been answered
// 'ACK'       – assistant placeholder row inserted immediately after a user
//               message is received. Its `id` is the platform's message ID
//               (e.g. the Telegram message ID, stored as a string) so the
//               processor can later edit that specific message in place once
//               the real AI response is ready. The `sessionId` doubles as the
//               platform channel/chat identifier.
export type MessageStatus = "pending" | "processed" | "ACK";
export type MessageRole = "user" | "assistant" | "system";

export interface Message {
	id: string;
	sessionId: string;
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
		timeStamp: data.timeStamp ?? new Date().toISOString(),
		role: data.role,
		content: data.content,
		status: data.status ?? "pending",
	};

	db.prepare(`
		INSERT INTO messages (id, sessionId, timeStamp, role, content, status)
		VALUES (@id, @sessionId, @timeStamp, @role, @content, @status)
	`).run(message);

	return message;
}

// Unified assistant message persistence:
// - status='ACK', platformMsgId provided → insert a new ack placeholder row
// - status='processed', platformMsgId provided → update that ack row's content and mark processed
// - status='processed', platformMsgId undefined → insert a new assistant row marked processed
export function updateOrInsertAssistantMessage(
	sessionId: string,
	content: string,
	status: MessageStatus,
	platformMsgId?: string,
): void {
	const db = getDb();
	if (status === "ACK" && platformMsgId !== undefined) {
		insertMessage({
			id: platformMsgId,
			sessionId,
			role: "assistant",
			status: "ACK",
			content,
		});
	} else if (status === "processed" && platformMsgId !== undefined) {
		db.prepare(
			"UPDATE messages SET content = ?, status = 'processed' WHERE id = ? AND sessionId = ?",
		).run(content, platformMsgId, sessionId);
	} else {
		insertMessage({
			sessionId,
			role: "assistant",
			content,
			status: "processed",
		});
	}
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
