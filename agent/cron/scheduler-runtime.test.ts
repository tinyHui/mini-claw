import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockBreeConstructor, mockBreeStart, mockLogger } = vi.hoisted(() => {
	return {
		mockBreeConstructor: vi.fn(),
		mockBreeStart: vi.fn().mockResolvedValue(undefined),
		mockLogger: {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			fatal: vi.fn(),
		},
	};
});

vi.mock("bree", () => ({
	default: class {
		start = mockBreeStart;

		constructor(options: unknown) {
			mockBreeConstructor(options);
		}
	},
}));

vi.mock("../logger.js", () => ({
	logger: mockLogger,
}));

import { startCronScheduler } from "./scheduler-runtime.js";

describe("startCronScheduler", () => {
	let root: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		root = await mkdtemp(join(tmpdir(), "mini-claw-scheduler-"));
		await mkdir(join(root, "jobs"), { recursive: true });
		await mkdir(join(root, "capabilities", "001-summary"), { recursive: true });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("logs cron job and capability counts", async () => {
		await writeFile(join(root, "jobs", "digest.mjs"), "console.log('digest');\n");
		await writeFile(join(root, "jobs", "digest.cron"), "0 8 * * *\n");
		await writeFile(join(root, "capabilities", "001-summary", "index.mjs"), "export default async () => ({});\n");
		await writeFile(
			join(root, "capabilities", "001-summary", "manifest.yaml"),
			[
				"name: summary",
				"description: Summarise text",
				"input_schema: {}",
				"output_schema: {}",
				"",
			].join("\n"),
		);

		const scheduler = await startCronScheduler({ cronDir: root });

		expect(scheduler.jobs).toHaveLength(1);
		expect(scheduler.capabilities).toHaveLength(1);
		expect(mockBreeConstructor).toHaveBeenCalledWith(expect.objectContaining({
			jobs: [
				expect.objectContaining({
					name: "digest",
					cron: "0 8 * * *",
				}),
			],
		}));
		expect(mockBreeStart).toHaveBeenCalledOnce();
		expect(mockLogger.info).toHaveBeenCalledWith("Cron scheduler scan completed", {
			operation: "cron_scan",
			cronDir: root,
			cronJobCount: 1,
			capabilityCount: 1,
			diagnosticErrorCount: 0,
			diagnosticWarningCount: 0,
		});
		expect(mockLogger.info).toHaveBeenCalledWith("Starting cron scheduler", {
			operation: "cron_start",
			cronDir: root,
			cronJobCount: 1,
			capabilityCount: 1,
		});
	});
});
