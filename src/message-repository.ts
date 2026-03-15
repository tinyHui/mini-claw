import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

// 'pending'   – user message waiting to be picked up by the AI processor
// 'processed' – user message that has been answered
// 'Ack'       – assistant placeholder row inserted immediately after a user
//               message is received. Its `id` is the platform's message ID
//               (e.g. the Telegram message ID, stored as a string) so the
//               processor can later edit that specific message in place once
//               the real AI response is ready. The `sessionId` doubles as the
//               platform channel/chat identifier.
export type MessageStatus = "pending" | "processed" | "Ack";
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

// Insert the platform acknowledgement message as an assistant row.
// platformMsgId must be the platform's own message ID so the processor can
// later edit that specific message via the platform's API.
export function insertAckMessage(
	platformMsgId: string,
	sessionId: string,
	content: string,
): Message {
	return insertMessage({
		id: platformMsgId,
		sessionId,
		role: "assistant",
		status: "Ack",
		content,
	});
}

// Update the ack row's content and promote its status to 'processed' once the
// real AI response has been produced. The processor calls this after editing
// the platform message in place.
export function resolveAckMessage(
	platformMsgId: string,
	sessionId: string,
	finalContent: string,
): void {
	const db = getDb();
	db.prepare(
		"UPDATE messages SET content = ?, status = 'processed' WHERE id = ? AND sessionId = ?",
	).run(finalContent, platformMsgId, sessionId);
}

// Mirrors the updateOrSendMessage channel logic in the database layer:
// - If platformMsgId is provided (ack existed), update that row's content and
//   mark it processed.
// - If platformMsgId is undefined (no ack was sent), insert a new assistant
//   message row with status 'processed'.
export function updateOrInsertAssistantMessage(
	sessionId: string,
	content: string,
	platformMsgId?: string,
): void {
	if (platformMsgId !== undefined) {
		resolveAckMessage(platformMsgId, sessionId, content);
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
