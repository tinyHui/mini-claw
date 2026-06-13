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
const validatorPath = join(repoRoot, "cron", "validator.mjs");

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
	const args = [validatorPath, "--cron-dir", join(root, "cron"), "--json"];
	if (writeDb) args.push("--write-db");
	try {
		const result = await execFileAsync(process.execPath, args, {
			cwd: root,
			encoding: "utf-8",
		});
		return {
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
			json: JSON.parse(result.stdout),
		};
	} catch (error) {
		const failed = error as Error & { code?: number; stdout?: string; stderr?: string };
		return {
			exitCode: typeof failed.code === "number" ? failed.code : 1,
			stdout: failed.stdout ?? "",
			stderr: failed.stderr ?? failed.message,
			json: JSON.parse(failed.stdout ?? "{}"),
		};
	}
}

async function writeValidJob(root: string, name = "digest"): Promise<void> {
	await mkdir(join(root, "cron", "jobs"), { recursive: true });
	await writeFile(
		join(root, "cron", "jobs", `${name}.mjs`),
		`// description: ${name} job\nexport async function run() { return ${JSON.stringify(name)}; }\n`,
	);
	await writeFile(join(root, "cron", "jobs", `${name}.cron`), "0 8 * * *\n");
}

async function writeValidCapability(root: string): Promise<void> {
	await mkdir(join(root, "cron", "capabilities", "001-summary"), { recursive: true });
	await writeFile(
		join(root, "cron", "capabilities", "001-summary", "manifest.yaml"),
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
		join(root, "cron", "capabilities", "001-summary", "index.mjs"),
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
				name, description, cronExpression, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
			) VALUES (
				'stale', 'Stale', '0 1 * * *', 0, 'cron/jobs/stale.mjs', 'cron/jobs/stale.cron', 'old', '2026-01-01T00:00:00.000Z'
			)
		`).run();
		sqlite.prepare(`
			INSERT INTO cron_capabilities (
				slug, name, description, manifestPath, entrypointPath, inputSchemaJson, outputSchemaJson, contentHash, validatedAt
			) VALUES (
				'999-stale', 'stale', 'Stale', 'cron/capabilities/999-stale/manifest.yaml',
				'cron/capabilities/999-stale/index.mjs', '{}', '{}', 'old', '2026-01-01T00:00:00.000Z'
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
		const jobs = verified.prepare("SELECT name, description, cronExpression, hasSeconds FROM cron_jobs").all();
		const capabilities = verified.prepare("SELECT slug, name, description FROM cron_capabilities").all();
		verified.close();
		expect(jobs).toEqual([{
			name: "digest",
			description: "digest job",
			cronExpression: "0 8 * * *",
			hasSeconds: 0,
		}]);
		expect(capabilities).toEqual([{
			slug: "001-summary",
			name: "summary",
			description: "Summarises text for cron jobs.",
		}]);
	});

	it("reports missing schedules", async () => {
		await mkdir(join(root, "cron", "jobs"), { recursive: true });
		await writeFile(join(root, "cron", "jobs", "missing.mjs"), "// description: Missing schedule\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("Missing schedule file missing.cron"),
			}),
		]);
	});

	it("reports orphan schedules as warnings", async () => {
		await mkdir(join(root, "cron", "jobs"), { recursive: true });
		await writeFile(join(root, "cron", "jobs", "orphan.cron"), "0 8 * * *\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(0);
		expect(result.json.warnings).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("has no matching orphan.mjs"),
			}),
		]);
	});

	it("reports invalid cron expressions", async () => {
		await mkdir(join(root, "cron", "jobs"), { recursive: true });
		await writeFile(join(root, "cron", "jobs", "bad.mjs"), "// description: Bad cron\n");
		await writeFile(join(root, "cron", "jobs", "bad.cron"), "not a cron\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors.some((error) => error.message.includes("Cron expression must have 5 fields"))).toBe(true);
	});

	it("reports missing job descriptions", async () => {
		await mkdir(join(root, "cron", "jobs"), { recursive: true });
		await writeFile(join(root, "cron", "jobs", "no_description.mjs"), "console.log('missing');\n");
		await writeFile(join(root, "cron", "jobs", "no_description.cron"), "0 8 * * *\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("// description: ..."),
			}),
		]);
	});

	it("reports malformed capability manifests", async () => {
		await mkdir(join(root, "cron", "capabilities", "001-bad"), { recursive: true });
		await writeFile(join(root, "cron", "capabilities", "001-bad", "manifest.yaml"), "name: [\n");
		await writeFile(join(root, "cron", "capabilities", "001-bad", "index.mjs"), "export {};\n");

		const result = await runValidator(root);

		expect(result.exitCode).toBe(1);
		expect(result.json.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("invalid YAML"),
			}),
		]);
	});
});
