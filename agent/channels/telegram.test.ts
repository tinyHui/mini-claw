import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";

const {
	mockSendMessage,
	mockEditMessageText,
	mockDeleteMessage,
	mockSetMyCommands,
	mockUse,
	mockCommand,
	mockOn,
	mockRestartCronPm2,
	mockGetSqlite,
	mockExistsSync,
	mockEnsureSession,
	mockResetSession,
	MockGrammyError,
} = vi.hoisted(() => {
	class MockGrammyError extends Error {
		readonly ok = false as const;
		constructor(
			message: string,
			public readonly error_code: number,
			public readonly description: string,
		) {
			super(message);
			this.name = "GrammyError";
		}
	}

	return {
		mockSendMessage: vi.fn(),
		mockEditMessageText: vi.fn(),
		mockDeleteMessage: vi.fn(),
		mockSetMyCommands: vi.fn().mockResolvedValue(undefined),
		mockUse: vi.fn(),
		mockCommand: vi.fn(),
		mockOn: vi.fn(),
		mockRestartCronPm2: vi.fn(),
		mockGetSqlite: vi.fn(),
		mockExistsSync: vi.fn(),
		mockEnsureSession: vi.fn(),
		mockResetSession: vi.fn(),
		MockGrammyError,
	};
});

vi.mock("node:fs", () => ({
	existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("grammy", () => ({
	GrammyError: MockGrammyError,
	Bot: class {
		api = {
			sendMessage: mockSendMessage,
			editMessageText: mockEditMessageText,
			deleteMessage: mockDeleteMessage,
			setMyCommands: mockSetMyCommands,
		};
		use = mockUse;
		command = mockCommand;
		on = mockOn;
		start = vi.fn();
		stop = vi.fn();
	},
	Context: class {},
}));

vi.mock("../logger.js", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	withLogContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("telegramify-markdown", () => ({
	default: (text: string) => `mdv2:${text}`,
}));

vi.mock("../rate-limiter.js", () => ({ checkRateLimit: vi.fn() }));
vi.mock("../session-repository.js", () => ({
	ensureSession: mockEnsureSession,
	resetSession: mockResetSession,
}));
vi.mock("../workspace.js", () => ({ getWorkspace: vi.fn(), formatPath: vi.fn((p: string) => p) }));
vi.mock("../cron/pm2.js", () => ({
	restartCronPm2: (...args: unknown[]) => mockRestartCronPm2(...args),
}));
vi.mock("../db.js", () => ({
	getSqlite: () => mockGetSqlite(),
}));

import { TelegramChannel, toTelegramMarkdown, type TelegramMessageSentCallback } from "./telegram.js";
import { checkRateLimit } from "../rate-limiter.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		telegramToken: "fake-token",
		appRoot: "/app",
		cronDir: "/app/generated/cron",
		workspace: "/tmp/ws",
		sessionDir: "/tmp/sessions",
		logLevel: "debug",
		thinkingLevel: "low",
		telegramUserId: 123,
		rateLimitCooldownMs: 5000,
		piTimeoutMs: 300000,
		shellTimeoutMs: 60000,
		sessionTitleTimeoutMs: 10000,
		memoryReviewEnabled: true,
		memoryReviewIntervalMs: 3600000,
		memoryReviewBatchLimit: 40,
		...overrides,
	};
}

function notModifiedError() {
	return new MockGrammyError(
		"Bad Request: message is not modified",
		400,
		"Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
	);
}

function apiError(desc: string) {
	return new MockGrammyError(`Bad Request: ${desc}`, 400, `Bad Request: ${desc}`);
}

interface CronTestRow {
	name: string;
	description?: string;
	cronExpression: string;
	enabled: number;
}

function mockCronDb(rows: CronTestRow[]) {
	const updateRun = vi.fn((enabled: number, name: string) => {
		const row = rows.find((item) => item.name === name);
		if (row) row.enabled = enabled;
	});
	const prepare = vi.fn((sql: string) => {
		if (sql.includes("UPDATE cron_jobs SET enabled")) {
			return { run: updateRun };
		}
		if (sql.includes("WHERE name = ?")) {
			return {
				get: (name: string) => rows.find((row) => row.name === name),
			};
		}
		return {
			all: () => rows,
		};
	});
	mockGetSqlite.mockReturnValue({ prepare });
	return { prepare, updateRun };
}

describe("TelegramChannel", () => {
	let channel: TelegramChannel;
	let sentCallback: ReturnType<typeof vi.fn<TelegramMessageSentCallback>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockSetMyCommands.mockResolvedValue(undefined);
		mockResetSession.mockReturnValue({ id: "session-123" });
		mockEnsureSession.mockReturnValue({ id: "session-123" });
		mockRestartCronPm2.mockResolvedValue({
			ok: true,
			processName: "mini-claw-cron",
			command: "pm2 startOrReload ecosystem.config.cjs --only mini-claw-cron --update-env",
			stdout: "",
			stderr: "",
		});
		mockCronDb([]);
		mockExistsSync.mockReturnValue(true);
		channel = new TelegramChannel(makeConfig());
		sentCallback = vi.fn<TelegramMessageSentCallback>();
		channel.onMessageSent(sentCallback);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("sendAckMessage", () => {
		it("sends a message and returns the platform message ID", async () => {
			mockSendMessage.mockResolvedValue({ message_id: 42 });

			const id = await channel.sendAckMessage("123", "session-1", "Ack!");
			expect(id).toBe("42");
			expect(mockSendMessage).toHaveBeenCalledWith(123, "Ack!");
		});

		it("fires messageSentCallback with ACK status", async () => {
			mockSendMessage.mockResolvedValue({ message_id: 42 });

			await channel.sendAckMessage("123", "session-1", "Ack!");
			expect(sentCallback).toHaveBeenCalledWith("session-1", "42", "Ack!", "ACK");
		});

		it("returns undefined when send fails", async () => {
			mockSendMessage.mockRejectedValue(new Error("network"));

			const id = await channel.sendAckMessage("123", "session-1", "Ack!");
			expect(id).toBeUndefined();
		});
	});

	describe("updateOrSendMessage — edit path", () => {
		it("edits the existing message with MarkdownV2 formatting", async () => {
			mockEditMessageText.mockResolvedValue(true);

			await channel.updateOrSendMessage("123", "s1", "Hello **world**", "42", "processed");

			expect(mockEditMessageText).toHaveBeenCalledWith(
				123, 42, "mdv2:Hello **world**", { parse_mode: "MarkdownV2" },
			);
		});

		it("fires callback with the original Telegram message ID on successful edit", async () => {
			mockEditMessageText.mockResolvedValue(true);

			await channel.updateOrSendMessage("123", "s1", "Done", "42", "processed");

			expect(sentCallback).toHaveBeenCalledWith("s1", "42", "Done", "processed");
		});

		it("silently handles 'message is not modified' without sending a new message", async () => {
			mockEditMessageText.mockRejectedValue(notModifiedError());

			await channel.updateOrSendMessage("123", "s1", "same", "42", "ACK");

			expect(mockSendMessage).not.toHaveBeenCalled();
			expect(mockDeleteMessage).not.toHaveBeenCalled();
		});

		it("falls back to plain-text edit when MarkdownV2 edit fails", async () => {
			mockEditMessageText
				.mockRejectedValueOnce(apiError("can't parse entities"))
				.mockResolvedValueOnce(true);

			await channel.updateOrSendMessage("123", "s1", "Hello **world**", "42", "processed");

			expect(mockEditMessageText).toHaveBeenCalledTimes(2);
			expect(mockEditMessageText).toHaveBeenNthCalledWith(
				2, 123, 42, "Hello **world**",
			);
		});

		it("deletes old message and sends new when both edits fail", async () => {
			mockEditMessageText
				.mockRejectedValueOnce(apiError("something"))
				.mockRejectedValueOnce(apiError("something else"));
			mockDeleteMessage.mockResolvedValue(true);
			mockSendMessage.mockResolvedValue({ message_id: 99 });

			await channel.updateOrSendMessage("123", "s1", "content", "42", "processed");

			expect(mockDeleteMessage).toHaveBeenCalledWith(123, 42);
			expect(mockSendMessage).toHaveBeenCalled();
		});

		it("still fires callback with original Telegram message ID when falling back to new message", async () => {
			mockEditMessageText
				.mockRejectedValueOnce(apiError("err1"))
				.mockRejectedValueOnce(apiError("err2"));
			mockDeleteMessage.mockResolvedValue(true);
			mockSendMessage.mockResolvedValue({ message_id: 99 });

			await channel.updateOrSendMessage("123", "s1", "content", "42", "processed");

			expect(sentCallback).toHaveBeenCalledWith("s1", "42", "content", "processed");
		});
	});

	describe("updateOrSendMessage — long content", () => {
		const longContent = "x".repeat(5000);

		it("deletes the old message and sends new split messages for content > 4096 chars", async () => {
			mockDeleteMessage.mockResolvedValue(true);
			mockSendMessage.mockResolvedValue({ message_id: 100 });

			await channel.updateOrSendMessage("123", "s1", longContent, "42", "processed");

			expect(mockEditMessageText).not.toHaveBeenCalled();
			expect(mockDeleteMessage).toHaveBeenCalledWith(123, 42);
			expect(mockSendMessage).toHaveBeenCalled();
		});

		it("still works when delete fails for long content", async () => {
			mockDeleteMessage.mockRejectedValue(new Error("can't delete"));
			mockSendMessage.mockResolvedValue({ message_id: 100 });

			await channel.updateOrSendMessage("123", "s1", longContent, "42", "processed");

			expect(mockSendMessage).toHaveBeenCalled();
		});
	});

	describe("updateOrSendMessage — no Telegram message ID", () => {
		it("sends a new message when no Telegram message ID is provided", async () => {
			mockSendMessage.mockResolvedValue({ message_id: 55 });

			await channel.updateOrSendMessage("123", "s1", "Hello", undefined, "processed");

			expect(mockEditMessageText).not.toHaveBeenCalled();
			expect(mockSendMessage).toHaveBeenCalled();
		});

		it("does not fire callback for ACK status", async () => {
			mockSendMessage.mockResolvedValue({ message_id: 55 });

			await channel.updateOrSendMessage("123", "s1", "status", undefined, "ACK");

			expect(sentCallback).not.toHaveBeenCalled();
		});
	});

	describe("single-user authorization", () => {
		it("always registers auth middleware", () => {
			new TelegramChannel(makeConfig());
			expect(mockUse).toHaveBeenCalled();
		});

		it("allows only the configured Telegram user ID", async () => {
			new TelegramChannel(makeConfig({ telegramUserId: 123 }));
			const middleware = mockUse.mock.calls[0]![0] as (
				ctx: { from?: { id: number }; reply: ReturnType<typeof vi.fn> },
				next: ReturnType<typeof vi.fn>,
			) => Promise<void>;
			const next = vi.fn();
			const reply = vi.fn();

			await middleware({ from: { id: 123 }, reply }, next);
			expect(next).toHaveBeenCalledOnce();
			expect(reply).not.toHaveBeenCalled();

			next.mockClear();
			await middleware({ from: { id: 456 }, reply }, next);
			expect(next).not.toHaveBeenCalled();
			expect(reply).toHaveBeenCalledWith("Sorry, you are not authorized to use this bot.");

			reply.mockClear();
			await middleware({ reply }, next);
			expect(next).not.toHaveBeenCalled();
			expect(reply).toHaveBeenCalledWith("Sorry, you are not authorized to use this bot.");
		});
	});

	describe("incoming updates", () => {
		function commandHandler(name: string) {
			for (let index = mockCommand.mock.calls.length - 1; index >= 0; index -= 1) {
				const call = mockCommand.mock.calls[index] as unknown[];
				if (call[0] === name) {
					return call[1] as
						| ((ctx: { chat: { id: number }; message?: { text: string; message_id?: number } }) => Promise<void>)
						| undefined;
				}
			}
			return undefined as
				| ((ctx: { chat: { id: number }; message?: { text: string; message_id?: number } }) => Promise<void>)
				| undefined;
		}

		function textHandler() {
			const call = mockOn.mock.calls.find((item) => item[0] === "message:text") as unknown[] | undefined;
			return call?.[1] as
				| ((ctx: { chat: { id: number }; message: { text: string; message_id: number }; reply: ReturnType<typeof vi.fn> }) => Promise<void>)
				| undefined;
		}

		function unsupportedHandler() {
			const call = mockOn.mock.calls.find((item) => Array.isArray(item[0])) as unknown[] | undefined;
			return call?.[1] as
				| ((ctx: { chat: { id: number }; message: { message_id: number; photo?: unknown } }) => Promise<void>)
				| undefined;
		}

		it("registers /new, /status, /cron, and /memory commands", () => {
			expect(mockSetMyCommands).toHaveBeenCalledWith([
				{ command: "new", description: "Start a new session" },
				{ command: "status", description: "Show current session info" },
				{ command: "cron", description: "Manage cron jobs" },
				{ command: "memory", description: "Review and update memory" },
			]);
			expect(commandHandler("new")).toBeTypeOf("function");
			expect(commandHandler("session")).toBeUndefined();
			expect(commandHandler("cron")).toBeTypeOf("function");
			expect(commandHandler("memory")).toBeTypeOf("function");
			expect(mockCommand).toHaveBeenCalledTimes(4);
		});

		it("emits normalized command updates", async () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			channel.onIncoming(callback);

			await commandHandler("cron")?.({
				chat: { id: 123 },
				message: { text: "/cron@mini_claw_bot disable digest", message_id: 77 },
			});

			expect(callback).toHaveBeenCalledWith({
				kind: "command",
				chatId: "123",
				telegramMessageId: "77",
				text: "/cron@mini_claw_bot disable digest",
				command: "cron",
				args: ["disable", "digest"],
			});
		});

		it("emits normalized text message updates after rate limiting", async () => {
			vi.mocked(checkRateLimit).mockReturnValue({ allowed: true });
			const callback = vi.fn().mockResolvedValue(undefined);
			channel.onIncoming(callback);

			await textHandler()?.({
				chat: { id: 123 },
				message: { text: "hello", message_id: 88 },
				reply: vi.fn(),
			});

			expect(callback).toHaveBeenCalledWith({
				kind: "message",
				chatId: "123",
				telegramMessageId: "88",
				text: "hello",
			});
		});

		it("replies with rate limit text and does not emit an update", async () => {
			vi.mocked(checkRateLimit).mockReturnValue({
				allowed: false,
				retryAfterMs: 2500,
			});
			const callback = vi.fn().mockResolvedValue(undefined);
			const reply = vi.fn().mockResolvedValue(undefined);
			channel.onIncoming(callback);

			await textHandler()?.({
				chat: { id: 123 },
				message: { text: "hello", message_id: 88 },
				reply,
			});

			expect(reply).toHaveBeenCalledWith("Please wait 3s before sending another message.");
			expect(callback).not.toHaveBeenCalled();
		});

		it("emits normalized unsupported updates", async () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			channel.onIncoming(callback);

			await unsupportedHandler()?.({
				chat: { id: 123 },
				message: { message_id: 99, photo: [] },
			});

			expect(callback).toHaveBeenCalledWith({
				kind: "unsupported",
				chatId: "123",
				telegramMessageId: "99",
				messageType: "photo",
			});
		});
	});
});

describe("toTelegramMarkdown", () => {
	it("delegates to telegramify-markdown with escape strategy", () => {
		const result = toTelegramMarkdown("Hello **world**");
		expect(result).toBe("mdv2:Hello **world**");
	});

	it("passes through plain text", () => {
		const result = toTelegramMarkdown("simple text");
		expect(result).toBe("mdv2:simple text");
	});

	it("handles code blocks", () => {
		const result = toTelegramMarkdown("```typescript\nconst x = 1;\n```");
		expect(result).toContain("const x = 1;");
	});
});
