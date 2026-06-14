import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";
import { MailboxTelegramDispatcher } from "./telegram-cron-output-dispatcher.js";

vi.mock("../agent/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

interface MailboxRow {
	id: string;
	jobName: string;
	channel: string;
	content: string;
	created_at: string;
	send_at: string | null;
	fail_reason: string | null;
}

function insertMailboxRow(sqlite: DatabaseType, row: Partial<MailboxRow> & { id: string }): void {
	sqlite.prepare(`
		INSERT INTO mailbox (id, jobName, channel, content, created_at, send_at, fail_reason)
		VALUES (@id, @jobName, @channel, @content, @created_at, @send_at, @fail_reason)
	`).run({
		jobName: "digest",
		channel: "telegram",
		content: "hello from cron",
		created_at: "2026-06-13T10:00:00.000Z",
		send_at: null,
		fail_reason: null,
		...row,
	});
}

function readMailbox(sqlite: DatabaseType): MailboxRow[] {
	return sqlite
		.prepare("SELECT id, jobName, channel, content, created_at, send_at, fail_reason FROM mailbox ORDER BY created_at")
		.all() as MailboxRow[];
}

function makeTelegramApi(options: { fail?: boolean } = {}) {
	const sent: Array<{ chatId: number; text: string }> = [];
	const api = {
		sendMessage: vi.fn(async (chatId: number, text: string) => {
			sent.push({ chatId, text });
			if (options.fail) {
				throw new Error("telegram unavailable");
			}
			return { message_id: sent.length };
		}),
	};
	return { api, sent };
}

describe("telegram cron output mailman", () => {
	let root: string;
	let sqlite: DatabaseType;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-mailman-"));
		createMigratedDatabase(join(root, "miniclaw.db"));
		sqlite = new Database(join(root, "miniclaw.db"));
	});

	afterEach(async () => {
		sqlite?.close();
		await rm(root, { recursive: true, force: true });
	});

	it("sends unsent telegram rows and marks send_at", async () => {
		insertMailboxRow(sqlite, { id: "row-1" });
		const { api, sent } = makeTelegramApi();
		const dispatcher = new MailboxTelegramDispatcher({
			sqlite,
			telegramApi: api as never,
			telegramChatId: 123,
		});

		await dispatcher.pollOnceAsync();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			chatId: 123,
			text: expect.stringContaining("hello from cron"),
		});
		const [row] = readMailbox(sqlite);
		expect(row.send_at).toEqual(expect.any(String));
		expect(row.fail_reason).toBeNull();
	});

	it("leaves send_at empty and records fail_reason when telegram send fails", async () => {
		insertMailboxRow(sqlite, { id: "row-1" });
		const { api } = makeTelegramApi({ fail: true });
		const dispatcher = new MailboxTelegramDispatcher({
			sqlite,
			telegramApi: api as never,
			telegramChatId: 123,
		});

		await dispatcher.pollOnceAsync();

		const [row] = readMailbox(sqlite);
		expect(row.send_at).toBeNull();
		expect(row.fail_reason).toContain("telegram unavailable");
	});

	it("ignores rows for other channels", async () => {
		insertMailboxRow(sqlite, { id: "row-1", channel: "email" });
		const { api, sent } = makeTelegramApi();
		const dispatcher = new MailboxTelegramDispatcher({
			sqlite,
			telegramApi: api as never,
			telegramChatId: 123,
		});

		await dispatcher.pollOnceAsync();

		expect(sent).toHaveLength(0);
		const [row] = readMailbox(sqlite);
		expect(row.send_at).toBeNull();
	});

	it("processes rows oldest first", async () => {
		insertMailboxRow(sqlite, {
			id: "row-2",
			jobName: "later",
			content: "later content",
			created_at: "2026-06-13T11:00:00.000Z",
		});
		insertMailboxRow(sqlite, {
			id: "row-1",
			jobName: "early",
			content: "early content",
			created_at: "2026-06-13T10:00:00.000Z",
		});
		const { api, sent } = makeTelegramApi();
		const dispatcher = new MailboxTelegramDispatcher({
			sqlite,
			telegramApi: api as never,
			telegramChatId: 123,
		});

		await dispatcher.pollOnceAsync();

		expect(sent.map((message) => message.text)).toEqual([
			expect.stringContaining("early content"),
			expect.stringContaining("later content"),
		]);
	});

	it("splits long telegram messages and marks the row sent", async () => {
		insertMailboxRow(sqlite, {
			id: "row-1",
			content: "x".repeat(5000),
		});
		const { api, sent } = makeTelegramApi();
		const dispatcher = new MailboxTelegramDispatcher({
			sqlite,
			telegramApi: api as never,
			telegramChatId: 123,
		});

		await dispatcher.pollOnceAsync();

		expect(sent).toHaveLength(2);
		const [row] = readMailbox(sqlite);
		expect(row.send_at).toEqual(expect.any(String));
		expect(row.fail_reason).toBeNull();
	});
});
