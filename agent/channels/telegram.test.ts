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

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		telegramToken: "fake-token",
		appRoot: "/app",
		cronDir: "/app/cron",
		workspace: "/tmp/ws",
		sessionDir: "/tmp/sessions",
		logLevel: "debug",
		thinkingLevel: "low",
		telegramUserId: 123,
		rateLimitCooldownMs: 5000,
		piTimeoutMs: 300000,
		shellTimeoutMs: 60000,
		sessionTitleTimeoutMs: 10000,
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
			command: "pm2 restart mini-claw-cron",
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

	describe("commands", () => {
		function commandHandler(name: string) {
			return mockCommand.mock.calls.find((call: unknown[]) => call[0] === name)?.[1] as
				| ((ctx: { chat: { id: number }; message?: { text: string }; reply: ReturnType<typeof vi.fn> }) => Promise<void>)
				| undefined;
		}

		it("registers /new, /status, and /cron commands", () => {
			expect(mockSetMyCommands).toHaveBeenCalledWith([
				{ command: "new", description: "Start a new session" },
				{ command: "status", description: "Show current session info" },
				{ command: "cron", description: "Manage cron jobs" },
			]);
			expect(commandHandler("new")).toBeTypeOf("function");
			expect(commandHandler("session")).toBeUndefined();
			expect(commandHandler("cron")).toBeTypeOf("function");
			expect(mockCommand).toHaveBeenCalledTimes(3);
		});

		it("starts a new session with /new", async () => {
			const reply = vi.fn().mockResolvedValue(undefined);
			await commandHandler("new")?.({ chat: { id: 123 }, reply });

			expect(mockResetSession).toHaveBeenCalledOnce();
			expect(reply).toHaveBeenCalledWith("New session started.");
		});

		it("shows /cron help when no parameter is provided", async () => {
			const reply = vi.fn().mockResolvedValue(undefined);
			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron" }, reply });

			expect(reply).toHaveBeenCalledWith([
				"Cron commands:",
				"/cron list",
				"/cron disable <name>",
				"/cron enable <name>",
				"/cron restart",
			].join("\n"));
		});

		it("restarts cron with /cron restart", async () => {
			const reply = vi.fn().mockResolvedValue(undefined);
			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron restart" }, reply });

			expect(mockRestartCronPm2).toHaveBeenCalledWith({ appRoot: "/app" });
			expect(reply).toHaveBeenCalledWith("Cron scheduler restarted (mini-claw-cron).");
		});

		it("reports cron restart failure with /cron restart", async () => {
			mockRestartCronPm2.mockResolvedValueOnce({
				ok: false,
				processName: "mini-claw-cron",
				command: "pm2 restart mini-claw-cron",
				stdout: "",
				stderr: "not found",
				error: "not found",
			});
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron restart" }, reply });

			expect(reply).toHaveBeenCalledWith(
				"Failed to restart cron scheduler (mini-claw-cron): not found",
			);
		});

		it("lists cron jobs from the DB", async () => {
			mockCronDb([
				{ name: "digest", cronExpression: "0 8 * * *", enabled: 1 },
				{ name: "cleanup", cronExpression: "0 1 * * *", enabled: 0 },
			]);
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron list" }, reply });

			expect(reply).toHaveBeenCalledWith([
				"Cron jobs:",
				"- digest: 0 8 * * * (enabled)",
				"- cleanup: 0 1 * * * (disabled)",
			].join("\n"));
		});

		it("disables a cron job and restarts the cron process", async () => {
			const db = mockCronDb([{ name: "digest", cronExpression: "0 8 * * *", enabled: 1 }]);
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron disable digest" }, reply });

			expect(db.updateRun).toHaveBeenCalledWith(0, "digest");
			expect(mockRestartCronPm2).toHaveBeenCalledWith({ appRoot: "/app" });
			expect(reply).toHaveBeenCalledWith("Cron job digest disabled. Restarted mini-claw-cron.");
		});

		it("enables a cron job when its script file exists", async () => {
			const db = mockCronDb([{ name: "digest", cronExpression: "0 8 * * *", enabled: 0 }]);
			mockExistsSync.mockReturnValueOnce(true);
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron enable digest" }, reply });

			expect(mockExistsSync).toHaveBeenCalledWith("/app/cron/jobs/digest.mjs");
			expect(db.updateRun).toHaveBeenCalledWith(1, "digest");
			expect(mockRestartCronPm2).toHaveBeenCalledWith({ appRoot: "/app" });
			expect(reply).toHaveBeenCalledWith("Cron job digest enabled. Restarted mini-claw-cron.");
		});

		it("rejects enabling a cron job when its script file is missing", async () => {
			const db = mockCronDb([{ name: "digest", cronExpression: "0 8 * * *", enabled: 0 }]);
			mockExistsSync.mockReturnValueOnce(false);
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron enable digest" }, reply });

			expect(db.updateRun).not.toHaveBeenCalled();
			expect(mockRestartCronPm2).not.toHaveBeenCalled();
			expect(reply).toHaveBeenCalledWith("Cannot enable digest: cron/jobs/digest.mjs was not found.");
		});

		it("does not restart when a cron job name is not found", async () => {
			mockCronDb([]);
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron disable missing" }, reply });

			expect(mockRestartCronPm2).not.toHaveBeenCalled();
			expect(reply).toHaveBeenCalledWith("Cron job not found: missing");
		});

		it("reports restart failure after updating cron job status", async () => {
			const db = mockCronDb([{ name: "digest", cronExpression: "0 8 * * *", enabled: 1 }]);
			mockRestartCronPm2.mockResolvedValueOnce({
				ok: false,
				processName: "mini-claw-cron",
				command: "pm2 restart mini-claw-cron",
				stdout: "",
				stderr: "not found",
				error: "not found",
			});
			const reply = vi.fn().mockResolvedValue(undefined);

			await commandHandler("cron")?.({ chat: { id: 123 }, message: { text: "/cron disable digest" }, reply });

			expect(db.updateRun).toHaveBeenCalledWith(0, "digest");
			expect(reply).toHaveBeenCalledWith(
				"Cron job digest disabled, but failed to restart mini-claw-cron: not found",
			);
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
