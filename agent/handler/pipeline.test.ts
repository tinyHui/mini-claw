import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { processTelegramUpdate } from "./pipeline.js";
import type { TelegramHandlerDispatcher } from "./dispatcher.js";
import type { TelegramDeliveryPort, TelegramProcessor } from "./types.js";

const {
	mockEnsureSession,
	mockInsertMessage,
	mockMarkMessageProcessed,
} = vi.hoisted(() => ({
	mockEnsureSession: vi.fn(),
	mockInsertMessage: vi.fn(),
	mockMarkMessageProcessed: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
	},
	withLogContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../session-repository.js", () => ({
	ensureSession: mockEnsureSession,
}));

vi.mock("../message-repository.js", () => ({
	insertMessage: (...args: unknown[]) => mockInsertMessage(...args),
	markMessageProcessed: (...args: unknown[]) => mockMarkMessageProcessed(...args),
}));

function makeConfig(): Config {
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
		memoryReviewEnabled: true,
		memoryReviewIntervalMs: 3600000,
		memoryReviewBatchLimit: 40,
	};
}

function makeChannel(): TelegramDeliveryPort & {
	sendAckMessage: ReturnType<typeof vi.fn<TelegramDeliveryPort["sendAckMessage"]>>;
	updateOrSendMessage: ReturnType<typeof vi.fn<TelegramDeliveryPort["updateOrSendMessage"]>>;
} {
	return {
		sendAckMessage: vi.fn<TelegramDeliveryPort["sendAckMessage"]>().mockResolvedValue("ack-1"),
		updateOrSendMessage: vi.fn<TelegramDeliveryPort["updateOrSendMessage"]>().mockResolvedValue(undefined),
	};
}

describe("processTelegramUpdate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnsureSession.mockReturnValue({ id: "session-1" });
		mockInsertMessage.mockReturnValue({ id: "user-1" });
	});

	it("persists normal messages and syncs ACK/final delivery", async () => {
		const channel = makeChannel();
		const processor: TelegramProcessor = {
			canHandle: () => true,
			process: vi.fn(async (_update, context) => {
				await context.progress.update("Halfway");
				return { content: "Done" };
			}),
		};
		const dispatcher = { resolve: () => processor } as unknown as TelegramHandlerDispatcher;

		await processTelegramUpdate({
			kind: "message",
			chatId: "123",
			telegramMessageId: "telegram-user-1",
			text: "hello",
		}, {
			config: makeConfig(),
			channel,
			dispatcher,
		});

		expect(mockInsertMessage).toHaveBeenCalledWith({
			sessionId: "session-1",
			id: "telegram-user-1",
			role: "user",
			content: "hello",
		});
		expect(channel.sendAckMessage).toHaveBeenCalledWith(
			"123",
			"session-1",
			expect.stringContaining("Working"),
			true,
		);
		expect(channel.updateOrSendMessage).toHaveBeenCalledWith(
			"123",
			"session-1",
			"Halfway",
			"ack-1",
			"ACK",
			true,
		);
		expect(channel.updateOrSendMessage).toHaveBeenLastCalledWith(
			"123",
			"session-1",
			"Done",
			"ack-1",
			"processed",
			true,
		);
		expect(mockMarkMessageProcessed).toHaveBeenCalledWith("user-1", "session-1");
	});

	it("uses transient delivery for commands and does not persist them", async () => {
		const channel = makeChannel();
		const processor: TelegramProcessor = {
			canHandle: () => true,
			process: vi.fn(async () => ({ content: "Command result" })),
		};
		const dispatcher = { resolve: () => processor } as unknown as TelegramHandlerDispatcher;

		await processTelegramUpdate({
			kind: "command",
			chatId: "123",
			telegramMessageId: "77",
			text: "/status",
			command: "status",
			args: [],
		}, {
			config: makeConfig(),
			channel,
			dispatcher,
		});

		expect(mockInsertMessage).not.toHaveBeenCalled();
		expect(mockMarkMessageProcessed).not.toHaveBeenCalled();
		expect(channel.sendAckMessage).toHaveBeenCalledWith(
			"123",
			"session-1",
			expect.stringContaining("Working"),
			false,
		);
		expect(channel.updateOrSendMessage).toHaveBeenLastCalledWith(
			"123",
			"session-1",
			"Command result",
			"ack-1",
			"processed",
			false,
		);
	});
});
