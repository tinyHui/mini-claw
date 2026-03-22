import { Bot, Context, GrammyError } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";
import type { Channel, DeliveryStatus, MessageCallback, MessageSentCallback } from "./channel.js";
import type { Config } from "../config.js";
import { logger, withLogContext } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";
import { ensureSession, resetSession } from "../session-repository.js";
import { formatPath, getWorkspace } from "../workspace.js";

export function toTelegramMarkdown(text: string): string {
	return telegramifyMarkdown(text, "escape");
}

const MAX_MESSAGE_LENGTH = 4096;

function splitMessage(text: string): string[] {
	if (text.length <= MAX_MESSAGE_LENGTH) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= MAX_MESSAGE_LENGTH) {
			chunks.push(remaining);
			break;
		}
		let splitIndex = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
		if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
			splitIndex = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
		}
		if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
			splitIndex = MAX_MESSAGE_LENGTH;
		}
		chunks.push(remaining.slice(0, splitIndex));
		remaining = remaining.slice(splitIndex).trimStart();
	}

	return chunks;
}

export class TelegramChannel implements Channel {
	private bot: Bot<Context>;
	private config: Config;
	private messageCallback: MessageCallback | null = null;
	private messageSentCallback: MessageSentCallback | null = null;

	constructor(config: Config) {
		this.config = config;
		this.bot = new Bot<Context>(config.telegramToken);
		this.setupHandlers();
	}

	onMessage(callback: MessageCallback): void {
		this.messageCallback = callback;
	}

	onMessageSent(callback: MessageSentCallback): void {
		this.messageSentCallback = callback;
	}

	async sendAckMessage(
		channelId: string,
		sessionId: string,
		content: string,
	): Promise<string | undefined> {
		const chatId = parseInt(channelId, 10);
		try {
			const msg = await this.bot.api.sendMessage(chatId, content);
			const ackMsgId = String(msg.message_id);
			if (this.messageSentCallback) {
				await this.messageSentCallback(sessionId, ackMsgId, content, "ACK");
			}
			return ackMsgId;
		} catch {
			return undefined;
		}
	}

	async updateOrSendMessage(
		channelId: string,
		sessionId: string,
		content: string,
		platformMsgId?: string,
		status: DeliveryStatus = "processed",
	): Promise<void> {
		const chatId = parseInt(channelId, 10);

		if (platformMsgId !== undefined) {
			await this.editOrReplaceMessage(chatId, parseInt(platformMsgId, 10), content);
		} else {
			await this.sendNewMessage(chatId, content);
		}

		if (status === "processed" && this.messageSentCallback) {
			await this.messageSentCallback(sessionId, platformMsgId ?? "unknown", content, "processed");
		}
	}

	private async editOrReplaceMessage(
		chatId: number,
		messageId: number,
		content: string,
	): Promise<void> {
		if (content.length > MAX_MESSAGE_LENGTH) {
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
		const chunks = splitMessage(content);
		let firstMsgId: string | undefined;
		for (const chunk of chunks) {
			try {
				const mdv2 = toTelegramMarkdown(chunk);
				const msg = await this.bot.api.sendMessage(chatId, mdv2, {
					parse_mode: "MarkdownV2",
				});
				firstMsgId ??= String(msg.message_id);
			} catch {
				const msg = await this.bot.api.sendMessage(chatId, chunk);
				firstMsgId ??= String(msg.message_id);
			}
		}
		return firstMsgId!;
	}

	async start(): Promise<void> {
		await this.bot.start({
			onStart: (botInfo) => {
				void withLogContext(
					{
						operation: "channel_start",
						channelId: "telegram",
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
		if (this.config.allowedUsers.length > 0) {
			this.bot.use(async (ctx, next) => {
				const uid = ctx.from?.id;
				if (uid && this.config.allowedUsers.includes(uid)) {
					await next();
				} else {
					await ctx.reply("Sorry, you are not authorized to use this bot.");
				}
			});
		}

		const commands = [
			{ command: "session", description: "Start a new session" },
			{ command: "status", description: "Show current session info" },
		];
		this.bot.api.setMyCommands(commands).catch(() => {});

		this.bot.command("session", async (ctx) => {
			const userId = String(ctx.from!.id);
			const session = resetSession(userId);
			await withLogContext(
				{
					operation: "session_reset",
					userId,
					channelId: String(ctx.chat.id),
					sessionId: session.id,
				},
				() => {
					logger.info("Started a new session");
				},
			);
			await ctx.reply("New session started.");
		});

		this.bot.command("status", async (ctx) => {
			const userId = String(ctx.from!.id);
			const cwd = await getWorkspace(String(ctx.chat.id));
			const session = ensureSession(userId);
			await ctx.reply(
				`Status:\n- Chat ID: ${ctx.chat.id}\n- Workspace: ${formatPath(cwd)}\n- Session: ${session.id.slice(0, 8)}…`,
			);
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
				await this.messageCallback(
					String(ctx.chat.id),
					String(ctx.from!.id),
					String(ctx.message.message_id),
					text,
				);
			}
		});

		this.bot.on([
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
		], async (ctx) => {
			await ctx.reply("This message type is not supported yet.");
		});
	}
}

export function createTelegramChannel(config: Config): TelegramChannel {
	return new TelegramChannel(config);
}
