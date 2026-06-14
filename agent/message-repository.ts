import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "./db.js";
import { messages, type MessageRow } from "./db/schema.js";

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

export type Message = MessageRow & {
	role: MessageRole;
	status: MessageStatus;
};

export type InsertMessageData = Omit<Message, "id" | "timeStamp" | "status" | "reviewedAt"> & {
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
		reviewedAt: null,
	};

	db.insert(messages).values(message).run();

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
		db.update(messages)
			.set({ content, status: "processed" })
			.where(and(eq(messages.id, platformMsgId), eq(messages.sessionId, sessionId)))
			.run();
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
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.role, "user"),
					eq(messages.status, "pending"),
					eq(messages.sessionId, sessionId),
				),
			)
			.orderBy(asc(messages.timeStamp))
			.all() as Message[];
	}
	return db
		.select()
		.from(messages)
		.where(and(eq(messages.role, "user"), eq(messages.status, "pending")))
		.orderBy(asc(messages.timeStamp))
		.all() as Message[];
}

export function markMessageProcessed(
	messageId: string,
	sessionId: string,
): void {
	const db = getDb();
	db.update(messages)
		.set({ status: "processed" })
		.where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
		.run();
}

export function getProcessedMessagesForReview(limit: number): Message[] {
	const db = getDb();
	return db
		.select()
		.from(messages)
		.where(and(eq(messages.status, "processed"), isNull(messages.reviewedAt)))
		.orderBy(asc(messages.timeStamp))
		.limit(limit)
		.all() as Message[];
}

export function getProcessedMessagesForReviewWindow(input: {
	start: Date;
	end: Date;
	limit: number;
}): Message[] {
	const db = getDb();
	return db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.status, "processed"),
				isNull(messages.reviewedAt),
				gte(messages.timeStamp, input.start.toISOString()),
				lte(messages.timeStamp, input.end.toISOString()),
			),
		)
		.orderBy(asc(messages.timeStamp))
		.limit(input.limit)
		.all() as Message[];
}

export function markMessagesReviewed(reviewedMessages: Pick<Message, "id" | "sessionId">[]): void {
	if (reviewedMessages.length === 0) return;
	const db = getDb();
	const reviewedAt = new Date().toISOString();
	for (const message of reviewedMessages) {
		db.update(messages)
			.set({ reviewedAt })
			.where(and(eq(messages.id, message.id), eq(messages.sessionId, message.sessionId)))
			.run();
	}
}
