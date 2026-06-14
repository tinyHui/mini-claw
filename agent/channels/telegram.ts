import { Bot, Context, GrammyError } from "grammy";
import type { Config } from "../config.js";
import { logger, withLogContext } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";
import type { IncomingTelegramUpdate } from "../handler/types.js";
import { sendTelegramText, TELEGRAM_MAX_MESSAGE_LENGTH } from "./telegram-delivery.js";
import { toTelegramMarkdown } from "./telegram-format.js";
export { toTelegramMarkdown } from "./telegram-format.js";

export type DeliveryStatus = "ACK" | "processed";

export type TelegramMessageCallback = (
	update: IncomingTelegramUpdate,
) => Promise<void>;

export type TelegramMessageSentCallback = (
	sessionId: string,
	telegramMessageId: string,
	content: string,
	status: DeliveryStatus,
) => Promise<void>;

export class TelegramChannel {
	private bot: Bot<Context>;
	private config: Config;
	private messageCallback: TelegramMessageCallback | null = null;
	private messageSentCallback: TelegramMessageSentCallback | null = null;

	constructor(config: Config) {
		this.config = config;
		this.bot = new Bot<Context>(config.telegramToken);
		this.setupHandlers();
	}

	onIncoming(callback: TelegramMessageCallback): void {
		this.messageCallback = callback;
	}

	onMessage(callback: TelegramMessageCallback): void {
		this.onIncoming(callback);
	}

	onMessageSent(callback: TelegramMessageSentCallback): void {
		this.messageSentCallback = callback;
	}

	async sendAckMessage(
		chatId: string,
		sessionId: string,
		content: string,
		syncDelivery = true,
	): Promise<string | undefined> {
		const telegramChatId = parseInt(chatId, 10);
		try {
			const msg = await this.bot.api.sendMessage(telegramChatId, content);
			const ackMsgId = String(msg.message_id);
			if (syncDelivery && this.messageSentCallback) {
				await this.messageSentCallback(sessionId, ackMsgId, content, "ACK");
			}
			return ackMsgId;
		} catch {
			return undefined;
		}
	}

	async updateOrSendMessage(
		chatId: string,
		sessionId: string,
		content: string,
		telegramMessageId?: string,
		status: DeliveryStatus = "processed",
		syncDelivery = true,
	): Promise<void> {
		const telegramChatId = parseInt(chatId, 10);

		if (telegramMessageId !== undefined) {
			await this.editOrReplaceMessage(telegramChatId, parseInt(telegramMessageId, 10), content);
		} else {
			await this.sendNewMessage(telegramChatId, content);
		}

		if (syncDelivery && status === "processed" && this.messageSentCallback) {
			await this.messageSentCallback(sessionId, telegramMessageId ?? "unknown", content, "processed");
		}
	}

	private async editOrReplaceMessage(
		chatId: number,
		messageId: number,
		content: string,
	): Promise<void> {
		if (content.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
			await this.tryDeleteMessage(chatId, messageId);
			await this.sendNewMessage(chatId, content);
			return;
		}

		try {
			const mdv2 = toTelegramMarkdown(content);
			await this.bot.api.editMessageText(chatId, messageId, mdv2, { parse_mode: "MarkdownV2" });
			return;
		} catch (err) {
			if (this.isMessageNotModified(err)) return;
			logger.debug("MarkdownV2 edit failed, trying plain text", {
				error: err instanceof GrammyError ? err.description : String(err),
			});
		}

		try {
			await this.bot.api.editMessageText(chatId, messageId, content);
			return;
		} catch (err) {
			if (this.isMessageNotModified(err)) return;
			logger.warn("Edit failed, replacing with new message", {
				chatId,
				messageId,
				error: err instanceof GrammyError ? err.description : String(err),
			});
		}

		await this.tryDeleteMessage(chatId, messageId);
		await this.sendNewMessage(chatId, content);
	}

	private async tryDeleteMessage(chatId: number, messageId: number): Promise<void> {
		try {
			await this.bot.api.deleteMessage(chatId, messageId);
		} catch {
			logger.debug("Could not delete message", { chatId, messageId });
		}
	}

	private isMessageNotModified(err: unknown): boolean {
		return err instanceof GrammyError && err.description.includes("message is not modified");
	}

	private async sendNewMessage(chatId: number, content: string): Promise<string> {
		return sendTelegramText(this.bot.api, chatId, content);
	}

	async start(): Promise<void> {
		await this.bot.start({
			onStart: (botInfo) => {
				void withLogContext(
					{
						operation: "channel_start",
						chatId: "telegram",
					},
					() => logger.info(`Bot @${botInfo.username} is running!`),
				);
			},
		});
	}

	stop(): void {
		this.bot.stop();
	}

	private setupHandlers(): void {
		this.bot.use(async (ctx, next) => {
			const uid = ctx.from?.id;
			if (uid === this.config.telegramUserId) {
				await next();
			} else {
				await ctx.reply("Sorry, you are not authorized to use this bot.");
			}
		});

		const commands = [
			{ command: "new", description: "Start a new session" },
			{ command: "status", description: "Show current session info" },
			{ command: "cron", description: "Manage cron jobs" },
			{ command: "memory", description: "Review and update memory" },
		];
		this.bot.api.setMyCommands(commands).catch(() => {});

		this.bot.command("new", async (ctx) => {
			await this.emitCommand(ctx, "new");
		});

		this.bot.command("cron", async (ctx) => {
			await this.emitCommand(ctx, "cron");
		});

		this.bot.command("memory", async (ctx) => {
			await this.emitCommand(ctx, "memory");
		});

		this.bot.command("status", async (ctx) => {
			await this.emitCommand(ctx, "status");
		});

		this.bot.on("message:text", async (ctx) => {
			const text = ctx.message.text;
			if (text.startsWith("/")) return;

			const rateLimit = checkRateLimit(
				ctx.chat.id,
				this.config.rateLimitCooldownMs,
			);
			if (!rateLimit.allowed) {
				const seconds = Math.ceil((rateLimit.retryAfterMs || 0) / 1000);
				await ctx.reply(
					`Please wait ${seconds}s before sending another message.`,
				);
				return;
			}

			if (this.messageCallback) {
				await this.messageCallback({
					kind: "message",
					chatId: String(ctx.chat.id),
					telegramMessageId: String(ctx.message.message_id),
					text,
				});
			}
		});

		const unsupportedTypes = [
			"message:photo",
			"message:document",
			"message:video",
			"message:voice",
			"message:audio",
			"message:sticker",
			"message:animation",
			"message:video_note",
			"message:contact",
			"message:location",
		] as Parameters<Bot<Context>["on"]>[0];
		this.bot.on(unsupportedTypes, async (ctx) => {
			if (!this.messageCallback) return;
			if (!ctx.chat) return;
			await this.messageCallback({
				kind: "unsupported",
				chatId: String(ctx.chat.id),
				telegramMessageId: String(ctx.message?.message_id ?? "unknown"),
				messageType: this.detectUnsupportedMessageType(ctx),
			});
		});
	}

	private async emitCommand(ctx: Context, fallbackCommand: string): Promise<void> {
		if (!this.messageCallback) return;
		if (!ctx.chat) return;
		const text = ctx.message?.text ?? `/${fallbackCommand}`;
		const commandToken = text.match(/^\/([^\s@]+)(?:@\S+)?/)?.[1] ?? fallbackCommand;
		const args = text.replace(/^\/[^\s@]+(?:@\S+)?/, "").trim();
		await this.messageCallback({
			kind: "command",
			chatId: String(ctx.chat.id),
			telegramMessageId: String(ctx.message?.message_id ?? "unknown"),
			text,
			command: commandToken,
			args: args ? args.split(/\s+/) : [],
		});
	}

	private detectUnsupportedMessageType(ctx: Context): string {
		const message = ctx.message as Record<string, unknown> | undefined;
		if (!message) return "unknown";
		for (const key of [
			"photo",
			"document",
			"video",
			"voice",
			"audio",
			"sticker",
			"animation",
			"video_note",
			"contact",
			"location",
		]) {
			if (key in message) return key;
		}
		return "unknown";
	}
}

export function createTelegramChannel(config: Config): TelegramChannel {
	return new TelegramChannel(config);
}
