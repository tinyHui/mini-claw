import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
	mkdir: (...args: unknown[]) => mockMkdir(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
	stat: (...args: unknown[]) => mockStat(...args),
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
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

	it("builds memory file paths under workspace", async () => {
		const { getMemoryPath, getUserPath } = await import("./pi-utils.js");
		expect(getMemoryPath("/tmp/workspace")).toBe("/tmp/workspace/MEMORY.md");
		expect(getUserPath("/tmp/workspace")).toBe("/tmp/workspace/USER.md");
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

	it("creates missing workspace memory files", async () => {
		const { ensureWorkspaceMemoryFiles } = await import("./pi-utils.js");
		mockStat.mockRejectedValue(new Error("ENOENT"));

		await ensureWorkspaceMemoryFiles("/tmp/workspace");

		expect(mockMkdir).toHaveBeenCalledWith("/tmp/workspace", { recursive: true });
		expect(mockWriteFile).toHaveBeenCalledTimes(2);
		expect(mockWriteFile).toHaveBeenCalledWith(
			"/tmp/workspace/MEMORY.md",
			expect.stringContaining("# Workspace Memory"),
			{ flag: "wx" },
		);
		expect(mockWriteFile).toHaveBeenCalledWith(
			"/tmp/workspace/USER.md",
			expect.stringContaining("# User Memory"),
			{ flag: "wx" },
		);
	});

	it("does not overwrite existing workspace memory files", async () => {
		const { ensureWorkspaceMemoryFiles } = await import("./pi-utils.js");
		mockStat.mockResolvedValue({ isFile: () => true, size: 10 });

		await ensureWorkspaceMemoryFiles("/tmp/workspace");

		expect(mockWriteFile).not.toHaveBeenCalled();
	});

	it("combines SOUL, MEMORY, and USER into one workspace prompt", async () => {
		const { readWorkspacePrompt } = await import("./pi-utils.js");
		mockStat.mockResolvedValue({ isFile: () => true, size: 10 });
		mockReadFile
			.mockResolvedValueOnce("Soul instructions\n")
			.mockResolvedValueOnce("Memory fact")
			.mockResolvedValueOnce("User fact");

		const prompt = await readWorkspacePrompt("/tmp/workspace");

		expect(prompt).toContain("Soul instructions");
		expect(prompt).toContain("## Workspace Memory");
		expect(prompt).toContain("Memory fact");
		expect(prompt).toContain("## User Memory");
		expect(prompt).toContain("User fact");
	});
});
