import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const runnerPath = join(repoRoot, "cron", "generic-runner.mjs");

async function runGenericRunner(root: string, task: string): Promise<{ exitCode: number; stderr: string }> {
	try {
		await execFileAsync(process.execPath, [runnerPath, task], {
			cwd: root,
			encoding: "utf-8",
		});
		return { exitCode: 0, stderr: "" };
	} catch (error) {
		const failed = error as Error & { code?: number; stderr?: string };
		return {
			exitCode: typeof failed.code === "number" ? failed.code : 1,
			stderr: failed.stderr ?? failed.message,
		};
	}
}

async function writeJob(root: string, name: string, body: string): Promise<void> {
	await mkdir(join(root, "cron", "jobs"), { recursive: true });
	await writeFile(join(root, "cron", "jobs", `${name}.mjs`), body);
}

function readCronOutputs(root: string): Array<{ jobName: string; content: string; status: string; error: string | null }> {
	const sqlite = new Database(join(root, "miniclaw.db"));
	try {
		return sqlite
			.prepare("SELECT jobName, content, status, error FROM cron_outputs ORDER BY createdAt")
			.all() as Array<{ jobName: string; content: string; status: string; error: string | null }>;
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
		expect(readCronOutputs(root)).toEqual([
			{
				jobName: "digest",
				content: "daily digest",
				status: "pending",
				error: null,
			},
		]);
	});

	it("records missing run exports as failed cron output", async () => {
		await writeJob(root, "missing_run", "export const value = 1;\n");

		const result = await runGenericRunner(root, "missing_run");

		expect(result.exitCode).toBe(1);
		expect(readCronOutputs(root)).toEqual([
			{
				jobName: "missing_run",
				content: "",
				status: "failed",
				error: expect.stringContaining("must export async function run()"),
			},
		]);
	});

	it("records non-string returns as failed cron output", async () => {
		await writeJob(root, "bad_return", "export async function run() { return { ok: true }; }\n");

		const result = await runGenericRunner(root, "bad_return");

		expect(result.exitCode).toBe(1);
		expect(readCronOutputs(root)).toEqual([
			{
				jobName: "bad_return",
				content: "",
				status: "failed",
				error: expect.stringContaining("must return a string"),
			},
		]);
	});
});
