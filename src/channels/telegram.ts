import { spawn } from "node:child_process";
import { Bot, Context } from "grammy";
import type { Channel, MessageCallback, MessageSentCallback } from "./channel.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { markdownToHtml, stripMarkdown } from "../markdown.js";
import { checkRateLimit } from "../rate-limiter.js";
import { ensureSession, getSession } from "../session-repository.js";
import { formatPath, getWorkspace, setWorkspace } from "../workspace.js";

interface ShellResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

async function runShell(
	cmd: string,
	cwd: string,
	timeoutMs: number,
): Promise<ShellResult> {
	return new Promise((resolve) => {
		const proc = spawn("bash", ["-c", cmd], {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		proc.on("close", (code) => {
			resolve({ stdout, stderr, code });
		});
		proc.on("error", (err) => {
			resolve({ stdout: "", stderr: err.message, code: 1 });
		});
		setTimeout(() => {
			proc.kill("SIGTERM");
			resolve({ stdout, stderr: `${stderr}\n(timeout)`, code: 124 });
		}, timeoutMs);
	});
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
		sessionId: string,
		content: string,
	): Promise<string | undefined> {
		const chatId = parseInt(sessionId, 10);
		try {
			const msg = await this.bot.api.sendMessage(chatId, content);
			return String(msg.message_id);
		} catch {
			return undefined;
		}
	}

	async updateOrSendMessage(
		sessionId: string,
		content: string,
		platformMsgId?: string,
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
				const msg = await this.sendNewMessage(chatId, content);
				deliveredMsgId = msg;
			}
		} else {
			// No ack message — send a new message
			deliveredMsgId = await this.sendNewMessage(chatId, content);
		}

		if (this.messageSentCallback) {
			await this.messageSentCallback(sessionId, deliveredMsgId, content);
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
				const msg = await this.bot.api.sendMessage(
					chatId,
					stripMarkdown(chunk),
				);
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
			{ command: "start", description: "Welcome & quick start" },
			{ command: "help", description: "Show all commands" },
			{ command: "pwd", description: "Show current directory" },
			{ command: "cd", description: "Change directory" },
			{ command: "home", description: "Go to home directory" },
			{ command: "shell", description: "Run shell command" },
			{ command: "status", description: "Show bot status" },
		];
		this.bot.api.setMyCommands(commands).catch(() => {});

		this.bot.command("start", async (ctx) => {
			const cwd = await setWorkspace(ctx.chat.id, this.config.workspace);
			ensureSession(String(ctx.chat.id));
			await ctx.reply(
				`Welcome to Mini-Claw!\nWorking directory: ${formatPath(cwd)}\n\nType /help for all commands.\nSend any message to start a conversation.`,
			);
		});

		this.bot.command("help", async (ctx) => {
			await ctx.reply(
				`Mini-Claw Commands\n\nNavigation:\n/pwd - Current directory\n/cd <path> - Change directory\n/home - Go to home directory\n\nExecution:\n/shell <cmd> - Run shell command\n\nInfo:\n/status - Bot status\n/help - This message\n\nTips:\n- Any text → AI conversation\n- /shell runs instantly, no AI\n- /cd supports ~, .., relative paths`,
			);
		});

		this.bot.command("pwd", async (ctx) => {
			const cwd = await getWorkspace(ctx.chat.id);
			await ctx.reply(formatPath(cwd));
		});

		this.bot.command("home", async (ctx) => {
			try {
				const cwd = await setWorkspace(ctx.chat.id, this.config.workspace);
				await ctx.reply(formatPath(cwd));
			} catch (err) {
				await ctx.reply(
					`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
				);
			}
		});

		this.bot.command("cd", async (ctx) => {
			const path = ctx.match?.trim();
			const target = path || this.config.workspace;
			try {
				const cwd = await setWorkspace(ctx.chat.id, target);
				await ctx.reply(formatPath(cwd));
			} catch (err) {
				await ctx.reply(
					`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
				);
			}
		});

		this.bot.command("status", async (ctx) => {
			const cwd = await getWorkspace(ctx.chat.id);
			const session = getSession(String(ctx.chat.id));
			await ctx.reply(
				`Status:\n- Chat ID: ${ctx.chat.id}\n- Workspace: ${formatPath(cwd)}\n- Session: ${session ? "active" : "none"}`,
			);
		});

		this.bot.command("shell", async (ctx) => {
			const cmd = ctx.match?.trim();
			if (!cmd) {
				await ctx.reply("Usage: /shell <command>\nExample: /shell ls -la");
				return;
			}
			const cwd = await getWorkspace(ctx.chat.id);
			await ctx.replyWithChatAction("typing");
			try {
				const result = await runShell(cmd, cwd, this.config.shellTimeoutMs);
				let output = "";
				if (result.stdout) output += result.stdout;
				if (result.stderr)
					output += `${output ? "\n" : ""}stderr: ${result.stderr}`;
				if (!output) output = "(no output)";
				if (result.code !== 0) output += `\n\n[exit code: ${result.code}]`;
				for (const chunk of splitMessage(output.trim())) {
					await ctx.reply(chunk);
				}
			} catch (err) {
				await ctx.reply(
					`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
				);
			}
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
				await this.messageCallback(String(ctx.chat.id), text);
			}
		});
	}
}

export function createTelegramChannel(config: Config): TelegramChannel {
	return new TelegramChannel(config);
}
