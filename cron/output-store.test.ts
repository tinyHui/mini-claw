import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";

describe("cron output store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-output-store-"));
		createMigratedDatabase(join(root, "miniclaw.db"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("persists pending cron output rows", async () => {
		// @ts-expect-error cron runtime modules are plain JavaScript executed by Node.
		const { publishCronOutput } = await import("./output-store.mjs");

		const row = publishCronOutput(
			{ jobName: "digest", content: "hello from cron" },
			join(root, "miniclaw.db"),
		);

		const sqlite = new Database(join(root, "miniclaw.db"));
		try {
			const outputs = sqlite
				.prepare("SELECT id, jobName, channel, content, created_at, send_at, fail_reason FROM mailbox")
				.all();
			expect(outputs).toEqual([
				{
					id: row.id,
					jobName: "digest",
					channel: "telegram",
					content: "hello from cron",
					created_at: row.created_at,
					send_at: null,
					fail_reason: null,
				},
			]);
		} finally {
			sqlite.close();
		}
	});
});
