import type { Config } from "../config.js";
import { logger, withLogContext } from "../logger.js";
import {
	insertMessage,
	markMessageProcessed,
} from "../message-repository.js";
import type { MemoryReviewWorker } from "../memory/worker.js";
import type { ActivityUpdate } from "../pi-runner.js";
import { ensureSession } from "../session-repository.js";
import { formatActivityStatus } from "./format.js";
import type { TelegramHandlerDispatcher } from "./dispatcher.js";
import type {
	IncomingTelegramUpdate,
	TelegramDeliveryPort,
} from "./types.js";

export interface TelegramPipelineOptions {
	config: Config;
	channel: TelegramDeliveryPort;
	dispatcher: TelegramHandlerDispatcher;
	memoryWorker?: MemoryReviewWorker;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function shouldPersist(update: IncomingTelegramUpdate): boolean {
	return update.kind === "message";
}

function initialStatus(): ActivityUpdate {
	return { type: "working", detail: "", elapsed: 0 };
}

export async function processTelegramUpdate(
	update: IncomingTelegramUpdate,
	options: TelegramPipelineOptions,
): Promise<void> {
	await withLogContext(
		{
			chatId: update.chatId,
			telegramMessageId: update.telegramMessageId,
			operation: "incoming_update",
		},
		async () => {
			const session = ensureSession();
			const sessionId = session.id;
			const persist = shouldPersist(update);

			await withLogContext({ sessionId }, async () => {
				const userMessage = persist && update.kind === "message"
					? insertMessage({
						sessionId,
						id: update.telegramMessageId,
						role: "user",
						content: update.text,
					})
					: undefined;

				if (userMessage) {
					logger.debug(`Saved user message ${userMessage.id}`);
				}

				const startedAt = Date.now();
				let lastActivity = initialStatus();
				let lastActivityUpdate = Date.now();
				const ackMsgId = await options.channel.sendAckMessage(
					update.chatId,
					sessionId,
					formatActivityStatus(initialStatus()),
					persist,
				);

				const updateProgress = async (content: string | ActivityUpdate): Promise<void> => {
					if (ackMsgId === undefined) return;
					try {
						if (typeof content === "string") {
							await options.channel.updateOrSendMessage(
								update.chatId,
								sessionId,
								content,
								ackMsgId,
								"ACK",
								persist,
							);
							return;
						}

						lastActivity = content;
						const now = Date.now();
						if (now - lastActivityUpdate < 2000) return;
						lastActivityUpdate = now;
						await options.channel.updateOrSendMessage(
							update.chatId,
							sessionId,
							formatActivityStatus(content),
							ackMsgId,
							"ACK",
							persist,
						);
					} catch (error) {
						logger.error("Failed to send progress update.", error);
					}
				};

				const ackInterval = setInterval(() => {
					if (ackMsgId === undefined) return;
					const elapsed = Math.floor((Date.now() - startedAt) / 1000);
					const tick: ActivityUpdate = {
						...lastActivity,
						elapsed,
					};
					void options.channel.updateOrSendMessage(
						update.chatId,
						sessionId,
						formatActivityStatus(tick),
						ackMsgId,
						"ACK",
						persist,
					).catch(() => {
						// best effort tick updates
					});
				}, 5000);

				try {
					const processor = options.dispatcher.resolve(update);
					const result = await processor.process(update, {
						config: options.config,
						sessionId,
						progress: { update: updateProgress },
						memoryWorker: options.memoryWorker,
					});

					clearInterval(ackInterval);
					await options.channel.updateOrSendMessage(
						update.chatId,
						sessionId,
						result.content,
						ackMsgId,
						"processed",
						persist,
					);

					if (userMessage) {
						markMessageProcessed(userMessage.id, sessionId);
					}
				} catch (error) {
					clearInterval(ackInterval);
					await options.channel.updateOrSendMessage(
						update.chatId,
						sessionId,
						`Failed to process: ${errorMessage(error)}`,
						ackMsgId,
						"processed",
						persist,
					);
					logger.error("Failed to process incoming update", error);
				}
			});
		},
	);
}
