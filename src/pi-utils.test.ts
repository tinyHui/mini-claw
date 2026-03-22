import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAccess = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
	access: (...args: unknown[]) => mockAccess(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
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

	it("does not create SOUL file when it already exists", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockAccess.mockResolvedValue(undefined);
		mockStat.mockResolvedValue({ isFile: () => true, size: 100 });

		await ensureSoulPromptFile("/tmp/workspace");

		expect(mockWriteFile).not.toHaveBeenCalled();
		expect(mockAccess).toHaveBeenCalledTimes(1);
		expect(mockStat).toHaveBeenCalledTimes(1);
	});

	it("creates SOUL file when missing and then proceeds", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockAccess.mockRejectedValueOnce(new Error("not found"));
		mockWriteFile.mockResolvedValue(undefined);
		mockStat.mockResolvedValue({ isFile: () => true, size: 100 });

		await ensureSoulPromptFile("/tmp/workspace");

		expect(mockWriteFile).toHaveBeenCalledWith(
			"/tmp/workspace/SOUL.md",
			"",
			{ flag: "wx" },
		);
		expect(mockAccess).toHaveBeenCalledTimes(1);
		expect(mockStat).toHaveBeenCalledTimes(1);
	});

	it("throws when SOUL file still missing after creation attempt", async () => {
		const { ensureSoulPromptFile } = await import("./pi-utils.js");
		mockAccess.mockRejectedValue(new Error("missing"));
		mockWriteFile.mockRejectedValue(new Error("cannot write"));
		mockStat.mockRejectedValue(new Error("ENOENT"));

		await expect(ensureSoulPromptFile("/tmp/workspace")).rejects.toThrow(
			"Missing required system prompt file: /tmp/workspace/SOUL.md",
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
