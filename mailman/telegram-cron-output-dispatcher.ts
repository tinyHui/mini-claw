import { mkdir } from "node:fs/promises";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { Bot, Context } from "grammy";
import { sendTelegramText } from "../agent/channels/telegram-delivery.js";
import { loadConfig } from "../agent/config.js";
import { getDefaultDatabasePath } from "../agent/db.js";
import { initializeLogger, logger } from "../agent/logger.js";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;

type TelegramApi = Bot<Context>["api"];

export interface MailboxTelegramDispatcherOptions {
	sqlite: DatabaseType;
	telegramApi: TelegramApi;
	telegramChatId: number;
	pollIntervalMs?: number;
	batchSize?: number;
}

interface MailboxRow {
	id: string;
	jobName: string;
	content: string;
}

function normalizePollInterval(value: string | undefined): number {
	if (value === undefined || value.trim() === "") return DEFAULT_POLL_INTERVAL_MS;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

export function errorStack(error: unknown): string {
	if (error instanceof Error) return error.stack ?? error.message;
	return String(error);
}

export function formatCronOutputMessage(row: MailboxRow): string {
	return `Cron output: ${row.jobName}\n\n${row.content}`;
}

export class MailboxTelegramDispatcher {
	private sqlite: DatabaseType;
	private telegramApi: TelegramApi;
	private telegramChatId: number;
	private pollIntervalMs: number;
	private batchSize: number;
	private stopped = false;
	private running = false;
	private timer: NodeJS.Timeout | undefined;

	constructor(options: MailboxTelegramDispatcherOptions) {
		this.sqlite = options.sqlite;
		this.telegramApi = options.telegramApi;
		this.telegramChatId = options.telegramChatId;
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	}

	pollInterval(): number {
		return this.pollIntervalMs;
	}

	async pollOnceAsync(): Promise<void> {
		if (this.running) {
			logger.info("Telegram cron output dispatch already running; skipping overlapping poll", {
				operation: "mailbox_telegram_poll_skipped",
			});
			return;
		}
		this.running = true;
		try {
			logger.info("Pulling unsent telegram mailbox rows", {
				operation: "mailbox_telegram_pull",
				batchSize: this.batchSize,
			});
			const rows = this.sqlite
				.prepare(`
					SELECT id, jobName, content
					FROM mailbox
					WHERE channel = 'telegram' AND send_at IS NULL
					ORDER BY created_at ASC
					LIMIT ?
				`)
				.all(this.batchSize) as MailboxRow[];

			logger.info("Dispatching telegram mailbox rows", {
				operation: "mailbox_telegram_dispatch",
				rowCount: rows.length,
			});
			for (const row of rows) {
				await this.dispatchRow(row);
			}
		} finally {
			this.running = false;
		}
	}

	start(): void {
		this.stopped = false;
		logger.info("Starting telegram cron output wait/dispatch loop", {
			operation: "mailbox_telegram_loop_start",
			pollIntervalMs: this.pollIntervalMs,
		});
		const tick = async () => {
			if (this.stopped) return;
			try {
				await this.pollOnceAsync();
			} catch (error) {
				logger.error("Telegram cron output dispatch poll failed", error, {
					operation: "mailbox_telegram_poll_failed",
				});
			}
			if (!this.stopped) {
				logger.info("Waiting for next telegram cron output dispatch", {
					operation: "mailbox_telegram_wait",
					pollIntervalMs: this.pollIntervalMs,
				});
				this.timer = setTimeout(() => void tick(), this.pollIntervalMs);
			}
		};
		void tick();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
	}

	private async dispatchRow(row: MailboxRow): Promise<void> {
		try {
			await sendTelegramText(this.telegramApi, this.telegramChatId, formatCronOutputMessage(row));
			this.sqlite
				.prepare("UPDATE mailbox SET send_at = ?, fail_reason = NULL WHERE id = ?")
				.run(new Date().toISOString(), row.id);
			logger.info("Sent cron output mailbox row", {
				operation: "mailbox_telegram_sent",
				mailboxId: row.id,
				jobName: row.jobName,
			});
		} catch (error) {
			const reason = errorStack(error);
			this.sqlite
				.prepare("UPDATE mailbox SET fail_reason = ? WHERE id = ?")
				.run(reason, row.id);
			logger.warn("Failed to send cron output mailbox row", {
				operation: "mailbox_telegram_failed",
				mailboxId: row.id,
				jobName: row.jobName,
				error: reason,
			});
		}
	}
}

export async function startMailboxTelegramDispatcher(): Promise<{
	dispatcher: MailboxTelegramDispatcher;
	sqlite: DatabaseType;
	bot: Bot<Context>;
}> {
	const config = loadConfig();
	initializeLogger("info", config.workspace);
	await mkdir(config.workspace, { recursive: true });

	logger.info("Telegram cron output mailman launched", {
		operation: "mailman_launched",
	});

	const sqlite = new Database(getDefaultDatabasePath(), { fileMustExist: true });
	const bot = new Bot<Context>(config.telegramToken);
	const dispatcher = new MailboxTelegramDispatcher({
		sqlite,
		telegramApi: bot.api,
		telegramChatId: config.telegramUserId,
		pollIntervalMs: normalizePollInterval(process.env.MAILMAN_POLL_INTERVAL_MS),
	});
	dispatcher.start();

	logger.info("Telegram cron output mailman started", {
		operation: "mailman_start",
		pollIntervalMs: dispatcher.pollInterval(),
	});

	return { dispatcher, sqlite, bot };
}
