import type { Config } from "../config.js";
import { logger, withLogContext } from "../logger.js";
import {
	insertMessage,
	markMessageProcessed,
} from "../message-repository.js";
import type { MemoryReviewWorker } from "../memory/worker.js";
import type { ActivityUpdate } from "../pi-runner.js";
import { ensureSession } from "../session-repository.js";
import { ProgressMessageState } from "./format.js";
import type { TelegramHandlerDispatcher } from "./dispatcher.js";
import type {
	IncomingTelegramUpdate,
	ProgressReporter,
	ProgressStep,
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
				let lastProgressUpdate = Date.now();
				const progressState = new ProgressMessageState(startedAt);
				if (update.kind === "message") {
					progressState.addStep({
						type: "planning",
						description: "Planning",
						key: "pi:planning",
					});
				}
				const ackMsgId = await options.channel.sendAckMessage(
					update.chatId,
					sessionId,
					progressState.render(startedAt),
					persist,
				);

				const flushProgress = async (): Promise<void> => {
					if (ackMsgId === undefined) return;
					try {
						await options.channel.updateOrSendMessage(
							update.chatId,
							sessionId,
							progressState.render(),
							ackMsgId,
							"ACK",
							persist,
						);
					} catch (error) {
						logger.error("Failed to send progress update.", error);
					}
				};

				const progress: ProgressReporter = {
					step: async (step: ProgressStep): Promise<void> => {
						const changed = progressState.addStep(step);
						if (!changed) return;
						lastProgressUpdate = Date.now();
						await flushProgress();
					},
					activity: async (activity: ActivityUpdate): Promise<void> => {
						const changed = progressState.addActivity(activity);
						const now = Date.now();
						if (!changed && now - lastProgressUpdate < 2000) return;
						lastProgressUpdate = now;
						await flushProgress();
					},
				};

				const ackInterval = setInterval(() => {
					if (ackMsgId === undefined) return;
					void options.channel.updateOrSendMessage(
						update.chatId,
						sessionId,
						progressState.render(),
						ackMsgId,
						"ACK",
						persist,
					).catch(() => {
						// best effort tick updates
					});
				}, 5000);

				try {
					const result = await options.dispatcher.dispatch(update, {
						config: options.config,
						sessionId,
						progress,
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
