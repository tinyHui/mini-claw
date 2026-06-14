import "dotenv/config";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { GENERATED_CRON_DIR } from "../cron/paths.js";

export interface Config {
	telegramToken: string;
	appRoot: string;
	cronDir: string;
	workspace: string;
	sessionDir: string;
	logLevel: string;
	thinkingLevel: "low" | "medium" | "high";
	telegramUserId: number;
	rateLimitCooldownMs: number;
	piTimeoutMs: number;
	shellTimeoutMs: number;
	sessionTitleTimeoutMs: number;
	memoryReviewEnabled: boolean;
	memoryReviewIntervalMs: number;
	memoryReviewBatchLimit: number;
}

let cachedConfig: Config | undefined;

export function loadConfig(): Config {
	if (cachedConfig) return cachedConfig;
	const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
	if (!token) {
		throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in .env file.");
	}

	const home = homedir();
	const appRoot = resolve(process.env.MINI_CLAW_APP_ROOT?.trim() || process.cwd());

	const workspace =
		process.env.MINI_CLAW_WORKSPACE?.trim() ||
		join(home, "mini-claw-workspace");

	const cronDir =
		process.env.MINI_CLAW_CRON_DIR?.trim() ||
		join(appRoot, GENERATED_CRON_DIR);

	const sessionDir =
		process.env.MINI_CLAW_SESSION_DIR?.trim() ||
		join(home, ".mini-claw", "sessions");

	const thinkingLevel = (process.env.PI_THINKING_LEVEL?.trim() || "low") as
		| "low"
		| "medium"
		| "high";

	const telegramUserIdRaw = process.env.TELEGRAM_USER_ID?.trim();
	if (!telegramUserIdRaw) {
		throw new Error("TELEGRAM_USER_ID is required. Set it to the single authorized Telegram user ID.");
	}
	if (!/^-?\d+$/.test(telegramUserIdRaw)) {
		throw new Error("TELEGRAM_USER_ID must be a numeric Telegram user ID.");
	}
	const telegramUserId = parseInt(telegramUserIdRaw, 10);

	// Rate limiting: default 5 seconds cooldown
	const rateLimitCooldownMs = parseInt(
		process.env.RATE_LIMIT_COOLDOWN_MS || "5000",
		10,
	);

	// Timeouts: defaults are Pi=5min, Shell=60s, SessionTitle=10s
	const piTimeoutMs = parseInt(
		process.env.PI_TIMEOUT_MS || String(5 * 60 * 1000),
		10,
	);
	const shellTimeoutMs = parseInt(process.env.SHELL_TIMEOUT_MS || "60000", 10);
	const sessionTitleTimeoutMs = parseInt(
		process.env.SESSION_TITLE_TIMEOUT_MS || "10000",
		10,
	);
	const memoryReviewEnabled =
		(process.env.MINI_CLAW_MEMORY_REVIEW_ENABLED?.trim() || "true").toLowerCase() !== "false";
	const memoryReviewIntervalMs = parseInt(
		process.env.MINI_CLAW_MEMORY_REVIEW_INTERVAL_MS || String(60 * 60 * 1000),
		10,
	);
	const memoryReviewBatchLimit = parseInt(
		process.env.MINI_CLAW_MEMORY_REVIEW_BATCH_LIMIT || "40",
		10,
	);

	const logLevel = process.env.LOG_LEVEL?.trim() || "info";

	cachedConfig = {
		telegramToken: token,
		appRoot,
		cronDir,
		workspace,
		sessionDir,
		logLevel,
		thinkingLevel,
		telegramUserId,
		rateLimitCooldownMs,
		piTimeoutMs,
		shellTimeoutMs,
		sessionTitleTimeoutMs,
		memoryReviewEnabled,
		memoryReviewIntervalMs,
		memoryReviewBatchLimit,
	};
	return cachedConfig;
}

export function resetConfigCache(): void {
	cachedConfig = undefined;
}
