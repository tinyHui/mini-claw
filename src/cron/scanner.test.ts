import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanCronJobs } from "./scanner.js";

describe("scanCronJobs", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-cron-"));
		await mkdir(join(root, "jobs"), { recursive: true });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("builds job definitions from matching .mjs and .cron files", async () => {
		await writeFile(join(root, "jobs", "daily_digest.mjs"), "console.log('ok');\n");
		await writeFile(join(root, "jobs", "daily_digest.cron"), "0 8 * * *\n");

		const result = await scanCronJobs(root);

		expect(result.diagnostics).toEqual([]);
		expect(result.jobs).toEqual([
			expect.objectContaining({
				name: "daily_digest",
				cron: "0 8 * * *",
				path: join(root, "jobs", "daily_digest.mjs"),
			}),
		]);
	});

	it("skips scripts without matching schedules", async () => {
		await writeFile(join(root, "jobs", "missing_schedule.mjs"), "console.log('ok');\n");

		const result = await scanCronJobs(root);

		expect(result.jobs).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				message: expect.stringContaining("Missing schedule file"),
			}),
		]);
	});

	it("reports orphan schedule files", async () => {
		await writeFile(join(root, "jobs", "orphan.cron"), "0 8 * * *\n");

		const result = await scanCronJobs(root);

		expect(result.jobs).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				level: "warn",
				message: expect.stringContaining("has no matching orphan.mjs"),
			}),
		]);
	});

	it("skips invalid cron expressions", async () => {
		await writeFile(join(root, "jobs", "bad.mjs"), "console.log('ok');\n");
		await writeFile(join(root, "jobs", "bad.cron"), "not a cron\n");

		const result = await scanCronJobs(root);

		expect(result.jobs).toEqual([]);
		expect(result.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
	});
});
