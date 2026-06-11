import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDb, initializeDatabase } from "./db.js";
import { messages } from "./db/schema.js";
import {
	getUnprocessedUserMessages,
	insertMessage,
	markMessageProcessed,
	updateOrInsertAssistantMessage,
} from "./message-repository.js";
import { createSession } from "./session-repository.js";

describe("message-repository", () => {
	let dir: string;
	let sessionId: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-db-"));
		initializeDatabase(dir);
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
});
