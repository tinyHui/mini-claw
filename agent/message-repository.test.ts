import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDb, initializeDatabase } from "./db.js";
import { messages } from "./db/schema.js";
import {
	getProcessedMessagesForReviewWindow,
	getUnprocessedUserMessages,
	insertMessage,
	markMessageProcessed,
	updateOrInsertAssistantMessage,
} from "./message-repository.js";
import { createSession } from "./session-repository.js";
import { createMigratedDatabase } from "./test-database.js";

describe("message-repository", () => {
	let dir: string;
	let sessionId: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-db-"));
		const dbPath = join(dir, "miniclaw.db");
		createMigratedDatabase(dbPath);
		initializeDatabase(dbPath);
		sessionId = createSession({ model: "default", thinkingLevel: "low" }).id;
	});

	afterEach(async () => {
		closeDatabase();
		await rm(dir, { recursive: true, force: true });
	});

	it("inserts and fetches pending user messages in timestamp order", () => {
		const later = insertMessage({
			id: "later",
			sessionId,
			role: "user",
			content: "later",
			timeStamp: "2026-03-22T10:00:01.000Z",
		});
		const earlier = insertMessage({
			id: "earlier",
			sessionId,
			role: "user",
			content: "earlier",
			timeStamp: "2026-03-22T10:00:00.000Z",
		});

		expect(getUnprocessedUserMessages(sessionId)).toEqual([earlier, later]);
	});

	it("updates ack assistant messages when processed content arrives", () => {
		updateOrInsertAssistantMessage(sessionId, "Working", "ACK", "42");
		updateOrInsertAssistantMessage(sessionId, "Done", "processed", "42");

		const saved = getDb().select().from(messages).get();
		expect(saved).toMatchObject({
			id: "42",
			sessionId,
			role: "assistant",
			content: "Done",
			status: "processed",
		});
	});

	it("marks user messages processed", () => {
		const message = insertMessage({
			id: "user-1",
			sessionId,
			role: "user",
			content: "hello",
		});

		markMessageProcessed(message.id, sessionId);

		expect(getUnprocessedUserMessages(sessionId)).toEqual([]);
	});

	it("fetches unreviewed processed messages inside the review window", () => {
		const beforeWindow = insertMessage({
			id: "before-window",
			sessionId,
			role: "user",
			content: "old",
			status: "processed",
			timeStamp: "2026-06-13T02:59:59.000Z",
		});
		const inWindow = insertMessage({
			id: "in-window",
			sessionId,
			role: "user",
			content: "inside",
			status: "processed",
			timeStamp: "2026-06-13T03:00:00.000Z",
		});
		const laterInWindow = insertMessage({
			id: "later-in-window",
			sessionId,
			role: "assistant",
			content: "inside later",
			status: "processed",
			timeStamp: "2026-06-13T04:00:00.000Z",
		});
		insertMessage({
			id: "pending",
			sessionId,
			role: "user",
			content: "pending",
			timeStamp: "2026-06-13T04:30:00.000Z",
		});
		const reviewed = insertMessage({
			id: "reviewed",
			sessionId,
			role: "user",
			content: "reviewed",
			status: "processed",
			timeStamp: "2026-06-13T05:00:00.000Z",
		});
		getDb().update(messages).set({ reviewedAt: "2026-06-13T06:00:00.000Z" }).where(eq(messages.id, reviewed.id)).run();

		const rows = getProcessedMessagesForReviewWindow({
			start: new Date("2026-06-13T03:00:00.000Z"),
			end: new Date("2026-06-13T04:30:00.000Z"),
			limit: 10,
		});

		expect(rows.map((row) => row.id)).toEqual([inWindow.id, laterInWindow.id]);
		expect(rows).not.toContain(beforeWindow);
	});

	it("limits review window messages in timestamp order", () => {
		const first = insertMessage({
			id: "first",
			sessionId,
			role: "user",
			content: "first",
			status: "processed",
			timeStamp: "2026-06-13T03:00:00.000Z",
		});
		insertMessage({
			id: "second",
			sessionId,
			role: "user",
			content: "second",
			status: "processed",
			timeStamp: "2026-06-13T03:01:00.000Z",
		});

		const rows = getProcessedMessagesForReviewWindow({
			start: new Date("2026-06-13T03:00:00.000Z"),
			end: new Date("2026-06-13T04:00:00.000Z"),
			limit: 1,
		});

		expect(rows.map((row) => row.id)).toEqual([first.id]);
	});
});
