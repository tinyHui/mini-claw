import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
	readFile: (...args: unknown[]) => mockReadFile(...args),
	stat: (...args: unknown[]) => mockStat(...args),
}));

describe("pi-utils", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("builds SOUL prompt path under workspace", async () => {
		const { getSoulPromptPath } = await import("./pi-utils.js");
		expect(getSoulPromptPath("/tmp/workspace")).toBe("/tmp/workspace/SOUL.md");
	});

	it("accepts an existing non-empty SOUL file", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockStat.mockResolvedValue({ isFile: () => true, size: 100 });

		await ensureSoulPromptFile("/tmp/workspace");

		expect(mockStat).toHaveBeenCalledTimes(1);
	});

	it("throws when SOUL file is missing", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockStat.mockRejectedValue(new Error("ENOENT"));

		await expect(ensureSoulPromptFile("/tmp/workspace")).rejects.toThrow(
			"Missing required system prompt file: /tmp/workspace/SOUL.md",
		);
	});

	it("throws when SOUL file is empty", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockStat.mockResolvedValue({ isFile: () => true, size: 0 });

		await expect(ensureSoulPromptFile("/tmp/workspace")).rejects.toThrow(
			"required and must not be empty",
		);
	});

	it("reads SOUL prompt content from workspace", async () => {
		const { readSoulPromptFile } = await import("./pi-utils.js");
		mockReadFile.mockResolvedValue("You are the soul prompt");

		await expect(readSoulPromptFile("/tmp/workspace")).resolves.toBe(
			"You are the soul prompt",
		);
		expect(mockReadFile).toHaveBeenCalledWith(
			"/tmp/workspace/SOUL.md",
			"utf-8",
		);
	});
});
