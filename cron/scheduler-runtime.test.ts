import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";

const repoRoot = process.cwd();

function cronRoot(root: string): string {
	return join(root, "generated", "cron");
}

async function writeScheduledJob(root: string, name: string): Promise<void> {
	await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
	await writeFile(
		join(cronRoot(root), "jobs", `${name}.mjs`),
		`// description: ${name} job\nexport async function run() { return ${JSON.stringify(name)}; }\n`,
	);
	await writeFile(join(cronRoot(root), "jobs", `${name}.cron`), "0 8 * * *\n");
}

async function writeBundledJob(root: string, name: string): Promise<void> {
	await mkdir(join(root, "cron", "jobs"), { recursive: true });
	await writeFile(
		join(root, "cron", "jobs", `${name}.ts`),
		`// description: ${name} bundled job\nexport async function run() {}\n`,
	);
	await writeFile(join(root, "cron", "jobs", `${name}.cron`), "55 2 * * *\n");
}

function insertCronJob(root: string, name: string, enabled = 1): void {
	const sqlite = new Database(join(root, "miniclaw.db"));
	sqlite.prepare(`
		INSERT INTO cron_jobs (
			name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
		) VALUES (
			@name, @description, @cronExpression, @enabled, 0, @scriptPath, @schedulePath, 'hash', '2026-01-01T00:00:00.000Z'
		)
	`).run({
		name,
		description: `${name} job`,
		cronExpression: "0 8 * * *",
		enabled,
		scriptPath: `${name}.mjs`,
		schedulePath: `${name}.cron`,
	});
	sqlite.close();
}

describe("cron scheduler runtime", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-scheduler-runtime-"));
		createMigratedDatabase(join(root, "miniclaw.db"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("registers scanned jobs against the generic runner with task worker data", async () => {
		await writeScheduledJob(root, "digest");
		insertCronJob(root, "digest");
		const { buildCronScheduler } = await import("./scheduler-runtime.js");

		const built = await buildCronScheduler({
			cronDir: cronRoot(root),
			dbPath: join(root, "miniclaw.db"),
			appRoot: root,
		});

		expect(built.bree.config.jobs).toEqual([
			expect.objectContaining({
				name: "digest",
				path: join(repoRoot, "cron", "generic-runner.js"),
				cron: "0 8 * * *",
				hasSeconds: false,
				worker: {
					workerData: {
						task: "digest",
						cronDir: cronRoot(root),
						modulePath: join(cronRoot(root), "jobs", "digest.mjs"),
						allowNoOutput: false,
					},
				},
			}),
		]);
	});

	it("does not register disabled DB jobs", async () => {
		await writeScheduledJob(root, "digest");
		insertCronJob(root, "digest", 0);
		const { buildCronScheduler } = await import("./scheduler-runtime.js");

		const built = await buildCronScheduler({
			cronDir: cronRoot(root),
			dbPath: join(root, "miniclaw.db"),
			appRoot: root,
		});

		expect(built.bree.config.jobs).toEqual([]);
		expect(built.jobs).toEqual([]);
	});

	it("deletes and skips enabled DB jobs when the script file is missing", async () => {
		insertCronJob(root, "missing", 1);
		const { buildCronScheduler } = await import("./scheduler-runtime.js");

		const built = await buildCronScheduler({
			cronDir: cronRoot(root),
			dbPath: join(root, "miniclaw.db"),
			appRoot: root,
		});

		const sqlite = new Database(join(root, "miniclaw.db"));
		const row = sqlite.prepare("SELECT enabled FROM cron_jobs WHERE name = 'missing'").get();
		sqlite.close();

		expect(built.bree.config.jobs).toEqual([]);
		expect(row).toBeUndefined();
	});

	it("registers bundled app jobs from cron/jobs", async () => {
		await writeBundledJob(root, "memory_review");
		const { buildCronScheduler } = await import("./scheduler-runtime.js");

		const built = await buildCronScheduler({
			cronDir: cronRoot(root),
			dbPath: join(root, "miniclaw.db"),
			appRoot: root,
		});

		expect(built.bree.config.jobs).toEqual([
			expect.objectContaining({
				name: "memory_review",
				cron: "55 2 * * *",
				hasSeconds: false,
				worker: {
					workerData: {
						task: "memory_review",
						cronDir: cronRoot(root),
						modulePath: join(root, "cron", "jobs", "memory_review.ts"),
						allowNoOutput: true,
					},
				},
			}),
		]);
	});
});
