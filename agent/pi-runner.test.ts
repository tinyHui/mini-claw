import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";

const mockMkdir = vi.fn();
const mockReadWorkspacePrompt = vi.fn();

const listeners: Array<(event: unknown) => void> = [];
const mockPrompt = vi.fn();
const mockFollowUp = vi.fn();
const mockAbort = vi.fn();
const mockGetLastAssistantText = vi.fn();

const mockGetAvailable = vi.fn();
const mockCreateAgentSession = vi.fn();

vi.mock("node:fs/promises", () => ({
	mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("./pi-utils.js", () => ({
	readWorkspacePrompt: (...args: unknown[]) => mockReadWorkspacePrompt(...args),
}));

vi.mock("./extensions/sandbox/index.js", () => ({
	isSandboxReady: vi.fn(() => false),
	createSandboxExtensionFactory: vi.fn(() => vi.fn()),
}));

vi.mock("./extensions/cron/cron-generator-extension.js", () => ({
	createCronGeneratorExtensionFactory: vi.fn(() => vi.fn()),
}));

vi.mock("./skills.js", () => ({
	mergeRepoSkills: vi.fn((base: unknown) => base),
}));

vi.mock("./logger.js", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

const mockSetSessionFile = vi.fn();
const mockResolveSessionHistoryPath = vi.fn();

vi.mock("./session-history-path.js", () => ({
	resolveSessionHistoryPath: (...args: unknown[]) => mockResolveSessionHistoryPath(...args),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: { create: vi.fn(() => ({})) },
	ModelRegistry: {
		create: vi.fn(() => ({
			getAvailable: mockGetAvailable,
		})),
	},
	DefaultResourceLoader: class {
		reload = vi.fn().mockResolvedValue(undefined);
	},
	getAgentDir: vi.fn(() => "/home/test/.pi/agent"),
	SessionManager: {
		create: vi.fn(() => ({
			setSessionFile: mockSetSessionFile,
		})),
	},
	createAgentSession: (...args: unknown[]) => mockCreateAgentSession(...args),
}));

describe("pi-runner", () => {
	const config: Config = {
		telegramToken: "token",
		appRoot: "/app",
		cronDir: "/app/cron",
		workspace: "/workspace",
		sessionDir: "/sessions",
		logLevel: "info",
		thinkingLevel: "low",
		telegramUserId: 123,
		rateLimitCooldownMs: 5000,
		piTimeoutMs: 300000,
		shellTimeoutMs: 60000,
		sessionTitleTimeoutMs: 10000,
		memoryReviewEnabled: true,
		memoryReviewIntervalMs: 3600000,
		memoryReviewBatchLimit: 40,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		vi.useFakeTimers();
		listeners.length = 0;
		mockMkdir.mockResolvedValue(undefined);
		mockReadWorkspacePrompt.mockResolvedValue("");
		mockResolveSessionHistoryPath.mockResolvedValue(
			"/sessions/20260322T120000_bf84f08c.jsonl",
		);
		mockGetAvailable.mockResolvedValue([{ provider: "anthropic", id: "x" }]);
		mockCreateAgentSession.mockResolvedValue({
			session: {
					subscribe: (listener: (event: unknown) => void) => {
					listeners.push(listener);
					return () => {};
				},
				prompt: mockPrompt,
				followUp: mockFollowUp,
				steer: vi.fn(),
				abort: mockAbort.mockResolvedValue(undefined),
				dispose: vi.fn(),
				getLastAssistantText: mockGetLastAssistantText,
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("checks auth through model registry availability", async () => {
		const { checkPiAuth } = await import("./pi-runner.js");
		mockGetAvailable.mockResolvedValueOnce([]);
		await expect(checkPiAuth()).resolves.toBe(false);
		mockGetAvailable.mockResolvedValueOnce([{ provider: "x", id: "y" }]);
		await expect(checkPiAuth()).resolves.toBe(true);
	});

	it("returns assistant text deltas as output", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "Hello " },
			});
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "world" },
			});
			listener({ type: "message_end" });
			listener({ type: "agent_end" });
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"hi",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("Hello world");
		expect(result.error).toBeUndefined();
	});

	it("queues followUp while current prompt is running", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		let releasePrompt: (() => void) | undefined;
		mockPrompt.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releasePrompt = resolve;
				}),
		);
		mockFollowUp.mockResolvedValue(undefined);

		const first = runPiWithStreaming(config, "sess-1", "first", "/workspace", () => {});
		const second = runPiWithStreaming(config, "sess-1", "second", "/workspace", () => {});

		await vi.waitFor(() => {
			expect(mockFollowUp).toHaveBeenCalledWith("second");
		});

		const listener = listeners[0];
		listener({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "one" },
		});
		listener({ type: "message_end" });
		listener({ type: "agent_end" });
		listener({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "two" },
		});
		listener({ type: "message_end" });
		listener({ type: "agent_end" });
		releasePrompt?.();

		await expect(first).resolves.toMatchObject({ output: "one" });
		await expect(second).resolves.toMatchObject({ output: "two" });
	});

	it("captures text from after tool execution, not premature empty text", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			// Turn 1: assistant sends empty text + tool call
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "" },
			});
			listener({ type: "message_end" });
			listener({ type: "tool_execution_start", toolName: "bash" });
			listener({ type: "tool_execution_end", toolName: "bash", isError: false });
			// Turn 2: assistant sends actual response after tool
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "Here are your files:\n- foo\n- bar" },
			});
			listener({ type: "message_end" });
			listener({ type: "agent_end" });
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"list files",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("Here are your files:\n- foo\n- bar");
	});

	it("captures text from both turns when first message has text alongside tool call", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			// Turn 1: assistant sends text + tool call
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "Let me check. " },
			});
			listener({ type: "message_end" });
			listener({ type: "tool_execution_start", toolName: "bash" });
			listener({ type: "tool_execution_end", toolName: "bash", isError: false });
			// Turn 2: assistant sends more text after tool
			listener({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "Found: file1, file2" },
			});
			listener({ type: "message_end" });
			listener({ type: "agent_end" });
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"list files",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("Let me check. Found: file1, file2");
	});

	it("falls back to getLastAssistantText when no text deltas received", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockGetLastAssistantText.mockReturnValue("fallback text");
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			listener({ type: "agent_end" });
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"hi",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("fallback text");
	});

	it("uses completed assistant message text when no text deltas or session fallback are available", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockGetLastAssistantText.mockReturnValue(undefined);
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			listener({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "final assistant text" }],
				},
			});
			listener({ type: "agent_end", messages: [] });
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"hi",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("final assistant text");
	});

	it("uses agent_end assistant messages when message_end text is unavailable", async () => {
		const { runPiWithStreaming } = await import("./pi-runner.js");
		mockGetLastAssistantText.mockReturnValue(undefined);
		mockPrompt.mockImplementation(async () => {
			const listener = listeners[0];
			listener({
				type: "agent_end",
				messages: [
					{ role: "user", content: "hi" },
					{
						role: "assistant",
						content: [{ type: "text", text: "agent end text" }],
					},
				],
			});
		});

		const result = await runPiWithStreaming(
			config,
			"sess-1",
			"hi",
			"/workspace",
			() => {},
		);
		expect(result.output).toBe("agent end text");
	});
});
