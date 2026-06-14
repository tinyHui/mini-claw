import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../agent/test-database.js";
import { runValidatorCommand } from "./validator.js";

function cronRoot(root: string): string {
	return join(root, "generated", "cron");
}

interface ValidatorRun {
	exitCode: number;
	stdout: string;
	stderr: string;
	json: {
		ok: boolean;
		counts: { jobs: number; capabilities: number; errors: number; warnings: number };
		errors: Array<{ level: string; message: string; file?: string }>;
		warnings: Array<{ level: string; message: string; file?: string }>;
	};
}

async function runValidator(root: string, writeDb = false): Promise<ValidatorRun> {
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		const result = await runValidatorCommand(["--cron-dir", cronRoot(root), "--json", ...(writeDb ? ["--write-db"] : [])]);
		return {
			exitCode: result.exitCode,
			stdout: JSON.stringify(result.result),
			stderr: "",
			json: result.result as ValidatorRun["json"],
		};
	} catch (error) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			json: {} as ValidatorRun["json"],
		};
	} finally {
		process.chdir(previousCwd);
	}
}

async function writeValidJob(root: string, name = "digest"): Promise<void> {
	await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
	await writeFile(
		join(cronRoot(root), "jobs", `${name}.mjs`),
		`// description: ${name} job\nexport async function run() { return ${JSON.stringify(name)}; }\n`,
	);
	await writeFile(join(cronRoot(root), "jobs", `${name}.cron`), "0 8 * * *\n");
}

async function writeValidCapability(root: string): Promise<void> {
	await mkdir(join(cronRoot(root), "capabilities", "001-summary"), { recursive: true });
	await writeFile(
		join(cronRoot(root), "capabilities", "001-summary", "manifest.yaml"),
		[
			"name: summary",
			"description: Summarises text for cron jobs.",
			"input_schema:",
			"  type: object",
			"output_schema:",
			"  type: object",
			"",
		].join("\n"),
	);
	await writeFile(
		join(cronRoot(root), "capabilities", "001-summary", "index.mjs"),
		"export async function summarize() { return {}; }\n",
	);
}

describe("cron validator", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-validator-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("writes valid jobs and capabilities to the registry and removes stale rows", async () => {
		createMigratedDatabase(join(root, "miniclaw.db"));
		const sqlite = new Database(join(root, "miniclaw.db"));
		sqlite.prepare(`
			INSERT INTO cron_jobs (
				name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
			) VALUES (
				'stale', 'Stale', '0 1 * * *', 1, 0, 'stale.mjs', 'stale.cron', 'old', '2026-01-01T00:00:00.000Z'
			)
		`).run();
		sqlite.prepare(`
			INSERT INTO cron_capabilities (
				slug, name, description, manifestPath, entrypointPath, inputSchemaJson, outputSchemaJson, contentHash, validatedAt
			) VALUES (
				'999-stale', 'stale', 'Stale', 'manifest.yaml',
				'index.mjs', '{}', '{}', 'old', '2026-01-01T00:00:00.000Z'
			)
		`).run();
		sqlite.close();
		await writeValidJob(root);
		await writeValidCapability(root);

		const result = await runValidator(root, true);

		expect(result.exitCode).toBe(0);
		expect(result.json.ok).toBe(true);
		expect(result.json.counts.jobs).toBe(1);
		expect(result.json.counts.capabilities).toBe(1);

		const verified = new Database(join(root, "miniclaw.db"));
		const jobs = verified.prepare("SELECT name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath FROM cron_jobs").all();
		const capabilities = verified.prepare("SELECT slug, name, description, manifestPath, entrypointPath FROM cron_capabilities").all();
		verified.close();
		expect(jobs).toEqual([{
			name: "digest",
			description: "digest job",
			cronExpression: "0 8 * * *",
			enabled: 1,
			hasSeconds: 0,
			scriptPath: "digest.mjs",
			schedulePath: "digest.cron",
		}]);
		expect(capabilities).toEqual([{
			slug: "001-summary",
			name: "summary",
			description: "Summarises text for cron jobs.",
			manifestPath: "manifest.yaml",
			entrypointPath: "index.mjs",
		}]);
	});

	it("keeps existing disabled jobs disabled when writing scanned registry rows", async () => {
		createMigratedDatabase(join(root, "miniclaw.db"));
		await writeValidJob(root);
		const sqlite = new Database(join(root, "miniclaw.db"));
		sqlite.prepare(`
			INSERT INTO cron_jobs (
				name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
			) VALUES (
				'digest', 'Old digest', '0 1 * * *', 0, 0, 'digest.mjs', 'digest.cron', 'old', '2026-01-01T00:00:00.000Z'
			)
		`).run();
		sqlite.close();

		const result = await runValidator(root, true);

		expect(result.exitCode).toBe(0);
		const verified = new Database(join(root, "miniclaw.db"));
		const job = verified.prepare("SELECT name, cronExpression, enabled FROM cron_jobs WHERE name = 'digest'").get();
		verified.close();
		expect(job).toEqual({
			name: "digest",
			cronExpression: "0 8 * * *",
			enabled: 0,
		});
	});

	it("reports missing schedules", async () => {
		await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
		await writeFile(join(cronRoot(root), "jobs", "missing.mjs"), "// description: Missing schedule\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("Missing schedule file missing.cron"),
			}),
		]);
	});

	it("reports orphan schedules as warnings", async () => {
		await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
		await writeFile(join(cronRoot(root), "jobs", "orphan.cron"), "0 8 * * *\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(0);
		expect(result.json.warnings).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("has no matching orphan.mjs"),
			}),
		]);
	});

	it("reports invalid cron expressions", async () => {
		await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
		await writeFile(join(cronRoot(root), "jobs", "bad.mjs"), "// description: Bad cron\n");
		await writeFile(join(cronRoot(root), "jobs", "bad.cron"), "not a cron\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors.some((error) => error.message.includes("Cron expression must have 5 fields"))).toBe(true);
	});

	it("reports missing job descriptions", async () => {
		await mkdir(join(cronRoot(root), "jobs"), { recursive: true });
		await writeFile(join(cronRoot(root), "jobs", "no_description.mjs"), "console.log('missing');\n");
		await writeFile(join(cronRoot(root), "jobs", "no_description.cron"), "0 8 * * *\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("// description: ..."),
			}),
		]);
	});

	it("reports malformed capability manifests", async () => {
		await mkdir(join(cronRoot(root), "capabilities", "001-bad"), { recursive: true });
		await writeFile(join(cronRoot(root), "capabilities", "001-bad", "manifest.yaml"), "name: [\n");
		await writeFile(join(cronRoot(root), "capabilities", "001-bad", "index.mjs"), "export {};\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("invalid YAML"),
			}),
		]);
	});
});
