import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { closeDatabase, getDb, initializeDatabase } from "../db.js";
import { memoryProposals } from "../db/schema.js";
import type { Message } from "../message-repository.js";
import { createMigratedDatabase } from "../test-database.js";
import { parseMemoryReviewOutput, reviewMemoryBatch } from "./reviewer.js";

function makeConfig(workspace: string): Config {
	return {
		telegramToken: "token",
		appRoot: "/app",
		cronDir: "/app/generated/cron",
		workspace,
		sessionDir: "/sessions",
		logLevel: "info",
		thinkingLevel: "low",
		telegramUserId: 123,
		rateLimitCooldownMs: 5000,
		piTimeoutMs: 300000,
		shellTimeoutMs: 60000,
		sessionTitleTimeoutMs: 10000,
		memoryReviewEnabled: true,
		memoryReviewIntervalMs: 3600000,
		memoryReviewBatchLimit: 40,
	};
}

function message(id: string, role: "user" | "assistant", content: string): Message {
	return {
		id,
		sessionId: "session-1",
		timeStamp: "2026-06-13T00:00:00.000Z",
		role,
		content,
		status: "processed",
		reviewedAt: null,
	};
}

describe("memory reviewer", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-memory-"));
		createMigratedDatabase(join(dir, "miniclaw.db"));
		initializeDatabase(join(dir, "miniclaw.db"));
		await writeFile(join(dir, "MEMORY.md"), "Mini-Claw runs as a Telegram assistant.\n", "utf-8");
		await writeFile(join(dir, "USER.md"), "- User prefers concise updates.\n", "utf-8");
	});

	afterEach(async () => {
		closeDatabase();
		await rm(dir, { recursive: true, force: true });
	});

	it("parses the required three-section Markdown output", () => {
		const parsed = parseMemoryReviewOutput([
			"# MEMORY.md",
			"Mini-Claw is a Telegram assistant.",
			"",
			"# USER.md",
			"- User prefers concise updates.",
			"",
			"# Process report",
			"Added one preference.",
		].join("\n"));

		expect(parsed).toEqual({
			memory: "Mini-Claw is a Telegram assistant.\n",
			user: "- User prefers concise updates.\n",
			report: "Added one preference.",
		});
	});

	it("accepts User.md heading case and ignores surrounding text", () => {
		const parsed = parseMemoryReviewOutput([
			"Review result:",
			"# MEMORY.md",
			"Mini-Claw keeps durable project notes.",
			"",
			"# User.md",
			"- User likes direct answers.",
			"",
			"# Process report",
			"Updated user preference.",
		].join("\n"));

		expect(parsed.user).toBe("- User likes direct answers.\n");
	});

	it("allows benign security wording in regenerated files", () => {
		const parsed = parseMemoryReviewOutput([
			"# MEMORY.md",
			"Mini-Claw requires a SOUL.md system prompt file. Do not store secrets in durable memory.",
			"",
			"# USER.md",
			"- User prefers concise answers.",
			"",
			"# Process report",
			"Preserved setup guidance.",
		].join("\n"));

		expect(parsed.memory).toContain("system prompt file");
		expect(parsed.memory).toContain("Do not store secrets");
	});

	it("rejects missing required sections", () => {
		expect(() => parseMemoryReviewOutput([
			"# MEMORY.md",
			"Mini-Claw keeps durable project notes.",
			"",
			"# Process report",
			"Missing user section.",
		].join("\n"))).toThrow(/must include/);
	});

	it("writes regenerated MEMORY.md and USER.md without inserting proposals", async () => {
		const messages = [
			message("m1", "user", "I like Apple stock."),
			message("m2", "assistant", "Noted."),
		];

		const result = await reviewMemoryBatch({
			config: makeConfig(dir),
			messages,
			review: async () => [
				"# MEMORY.md",
				"Mini-Claw runs as a Telegram assistant. It keeps concise durable notes about the operating environment.",
				"",
				"# USER.md",
				"- User prefers concise updates.",
				"- User likes Apple stock.",
				"",
				"# Process report",
				"Stored the user's Apple stock preference.",
			].join("\n"),
		});

		await expect(readFile(join(dir, "MEMORY.md"), "utf-8")).resolves.toBe(
			"Mini-Claw runs as a Telegram assistant. It keeps concise durable notes about the operating environment.\n",
		);
		await expect(readFile(join(dir, "USER.md"), "utf-8")).resolves.toBe(
			"- User prefers concise updates.\n- User likes Apple stock.\n",
		);
		expect(result.report).toBe("Stored the user's Apple stock preference.");
		expect(result.updatedMemory).toBe(true);
		expect(result.updatedUser).toBe(true);
		expect(getDb().select().from(memoryProposals).all()).toEqual([]);
	});

	it("does not write files when parsing fails", async () => {
		await expect(reviewMemoryBatch({
			config: makeConfig(dir),
			messages: [message("m1", "user", "I like Apple stock.")],
			review: async () => [
				"# MEMORY.md",
				"Mini-Claw runs as a Telegram assistant.",
				"",
				"# Process report",
				"Missing user section.",
			].join("\n"),
		})).rejects.toThrow(/must include/);

		await expect(readFile(join(dir, "MEMORY.md"), "utf-8")).resolves.toBe(
			"Mini-Claw runs as a Telegram assistant.\n",
		);
		await expect(readFile(join(dir, "USER.md"), "utf-8")).resolves.toBe(
			"- User prefers concise updates.\n",
		);
	});
});
