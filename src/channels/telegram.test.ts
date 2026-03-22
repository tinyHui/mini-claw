import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";

const {
	mockSendMessage,
	mockEditMessageText,
	mockDeleteMessage,
	mockSetMyCommands,
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
		MockGrammyError,
	};
});

vi.mock("grammy", () => ({
	GrammyError: MockGrammyError,
	Bot: class {
		api = {
			sendMessage: mockSendMessage,
			editMessageText: mockEditMessageText,
			deleteMessage: mockDeleteMessage,
			setMyCommands: () => Promise.resolve(),
		};
		use = vi.fn();
		command = vi.fn();
		on = vi.fn();
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
vi.mock("../session-repository.js", () => ({ ensureSession: vi.fn(), resetSession: vi.fn() }));
vi.mock("../workspace.js", () => ({ getWorkspace: vi.fn(), formatPath: vi.fn((p: string) => p) }));

import { TelegramChannel, toTelegramMarkdown } from "./telegram.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		telegramToken: "fake-token",
		workspace: "/tmp/ws",
		sessionDir: "/tmp/sessions",
		logLevel: "debug",
		thinkingLevel: "low",
		allowedUsers: [],
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

describe("TelegramChannel", () => {
	let channel: TelegramChannel;
	let sentCallback: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		channel = new TelegramChannel(makeConfig());
		sentCallback = vi.fn();
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

		it("fires callback with the original platformMsgId on successful edit", async () => {
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

		it("still fires callback with original platformMsgId when falling back to new message", async () => {
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

	describe("updateOrSendMessage — no platformMsgId", () => {
		it("sends a new message when no platformMsgId is provided", async () => {
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
