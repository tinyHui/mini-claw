import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();

async function writeScheduledJob(root: string, name: string): Promise<void> {
	await mkdir(join(root, "cron", "jobs"), { recursive: true });
	await writeFile(
		join(root, "cron", "jobs", `${name}.mjs`),
		`// description: ${name} job\nexport async function run() { return ${JSON.stringify(name)}; }\n`,
	);
	await writeFile(join(root, "cron", "jobs", `${name}.cron`), "0 8 * * *\n");
}

describe("cron scheduler runtime", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-scheduler-runtime-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("registers scanned jobs against the generic runner with task worker data", async () => {
		await writeScheduledJob(root, "digest");
		// @ts-expect-error cron runtime modules are plain JavaScript executed by Node.
		const { buildCronScheduler } = await import("./scheduler-runtime.mjs");

		const built = await buildCronScheduler({ cronDir: join(root, "cron") });

		expect(built.bree.config.jobs).toEqual([
			expect.objectContaining({
				name: "digest",
				path: join(repoRoot, "cron", "generic-runner.mjs"),
				cron: "0 8 * * *",
				hasSeconds: false,
				worker: {
					workerData: {
						task: "digest",
						cronDir: join(root, "cron"),
					},
				},
			}),
		]);
	});
});
