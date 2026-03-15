import { Bot, Context } from "grammy";
import type { Channel, DeliveryStatus, MessageCallback, MessageSentCallback } from "./channel.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { markdownToHtml, stripMarkdown } from "../markdown.js";
import { checkRateLimit } from "../rate-limiter.js";
import { getSession, resetSession } from "../session-repository.js";
import { formatPath, getWorkspace } from "../workspace.js";
import { randomUUID } from "node:crypto";

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
		sessionId: string,
		content: string,
	): Promise<string | undefined> {
		const chatId = parseInt(sessionId, 10);
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
		sessionId: string,
		content: string,
		platformMsgId?: string,
		status: DeliveryStatus = "processed",
	): Promise<void> {
		const chatId = parseInt(sessionId, 10);
		let deliveredMsgId: string;

		if (platformMsgId !== undefined) {
			// Edit the existing ack message in place
			try {
				await this.bot.api.editMessageText(
					chatId,
					parseInt(platformMsgId, 10),
					content,
				);
				deliveredMsgId = platformMsgId;
			} catch {
				// Edit failed — fall back to sending a new message
				logger.warn(
					`Failed to edit message ${platformMsgId} for session ${sessionId}, sending new message`,
				);
				deliveredMsgId = await this.sendNewMessage(chatId, content);
			}
		} else {
			// No ack message — send a new message
			deliveredMsgId = await this.sendNewMessage(chatId, content);
		}

		if (status === "processed" && this.messageSentCallback) {
			await this.messageSentCallback(sessionId, deliveredMsgId, content, "processed");
		}
	}

	private async sendNewMessage(chatId: number, content: string): Promise<string> {
		const chunks = splitMessage(content);
		let firstMsgId: string | undefined;
		for (const chunk of chunks) {
			try {
				const html = markdownToHtml(chunk);
				const msg = await this.bot.api.sendMessage(chatId, html, {
					parse_mode: "HTML",
				});
				firstMsgId ??= String(msg.message_id);
			} catch {
				const msg = await this.bot.api.sendMessage(chatId, stripMarkdown(chunk));
				firstMsgId ??= String(msg.message_id);
			}
		}
		return firstMsgId!;
	}

	async start(): Promise<void> {
		await this.bot.start({
			onStart: (botInfo) => {
				logger.info(`Bot @${botInfo.username} is running!`);
			},
		});
	}

	stop(): void {
		this.bot.stop();
	}

	private setupHandlers(): void {
		// Access control middleware
		if (this.config.allowedUsers.length > 0) {
			this.bot.use(async (ctx, next) => {
				const userId = ctx.from?.id;
				if (userId && this.config.allowedUsers.includes(userId)) {
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

		// /session — initialise a fresh session, resetting the conversation context
		this.bot.command("session", async (ctx) => {
			resetSession(randomUUID().toString());
			logger.info(`New session started for chat ${ctx.chat.id}`);
			await ctx.reply("New session started.");
		});

		// /status — show current session and workspace info
		this.bot.command("status", async (ctx) => {
			const cwd = await getWorkspace(ctx.chat.id);
			const session = getSession(String(ctx.chat.id));
			await ctx.reply(
				`Status:\n- Chat ID: ${ctx.chat.id}\n- Workspace: ${formatPath(cwd)}\n- Session: ${session ? "active" : "none"}`,
			);
		});

		// Ingestion-only message handler — AI processing is done in the
		// onMessage callback registered by the orchestration layer (index.ts).
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
					String(ctx.message.message_id),
					text,
				);
			}
		});
	}
}

export function createTelegramChannel(config: Config): TelegramChannel {
	return new TelegramChannel(config);
}
