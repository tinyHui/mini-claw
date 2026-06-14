import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";
import { runGenericCronWorker } from "./generic-runner.js";

function cronRoot(root: string): string {
	return join(root, "generated", "cron");
}

async function runGenericRunner(root: string, task: string): Promise<{ exitCode: number; stderr: string }> {
	try {
		await runGenericCronWorker({ task, cronDir: cronRoot(root), dbPath: join(root, "miniclaw.db") });
		return { exitCode: 0, stderr: "" };
	} catch (error) {
		return {
			exitCode: 1,
			stderr: error instanceof Error ? error.message : String(error),
		};
	}
}

async function writeJob(root: string, name: string, body: string): Promise<void> {
	await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
	await writeFile(join(cronRoot(root), "jobs", `${name}.mjs`), body);
}

function readMailbox(root: string): Array<{
	jobName: string;
	channel: string;
	content: string;
	send_at: string | null;
	fail_reason: string | null;
}> {
	const sqlite = new Database(join(root, "miniclaw.db"));
	try {
		return sqlite
			.prepare("SELECT jobName, channel, content, send_at, fail_reason FROM mailbox ORDER BY created_at")
			.all() as Array<{
				jobName: string;
				channel: string;
				content: string;
				send_at: string | null;
				fail_reason: string | null;
			}>;
	} finally {
		sqlite.close();
	}
}

describe("generic cron runner", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-generic-runner-"));
		createMigratedDatabase(join(root, "miniclaw.db"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("executes a job run export and persists returned string output", async () => {
		await writeJob(root, "digest", "export async function run() { return 'daily digest'; }\n");

		const result = await runGenericRunner(root, "digest");

		expect(result.exitCode).toBe(0);
		expect(readMailbox(root)).toEqual([
			{
				jobName: "digest",
				channel: "telegram",
				content: "daily digest",
				send_at: null,
				fail_reason: null,
			},
		]);
	});

	it("records missing run exports as failed cron output", async () => {
		await writeJob(root, "missing_run", "export const value = 1;\n");

		const result = await runGenericRunner(root, "missing_run");

		expect(result.exitCode).toBe(1);
		expect(readMailbox(root)).toEqual([
			{
				jobName: "missing_run",
				channel: "telegram",
				content: expect.stringContaining("must export async function run()"),
				send_at: null,
				fail_reason: null,
			},
		]);
	});

	it("records non-string returns as failed cron output", async () => {
		await writeJob(root, "bad_return", "export async function run() { return { ok: true }; }\n");

		const result = await runGenericRunner(root, "bad_return");

		expect(result.exitCode).toBe(1);
		expect(readMailbox(root)).toEqual([
			{
				jobName: "bad_return",
				channel: "telegram",
				content: expect.stringContaining("must return a string"),
				send_at: null,
				fail_reason: null,
			},
		]);
	});
});
