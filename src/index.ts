import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { createTelegramChannel } from "./channels/telegram.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { logger } from "./logger.js";
import {
	insertMessage,
	markMessageProcessed,
	updateOrInsertAssistantMessage,
} from "./message-repository.js";
import { type ActivityUpdate, checkPiAuth, runPiWithStreaming } from "./pi-runner.js";
import { ensureSession } from "./session-repository.js";
import { getWorkspace } from "./workspace.js";

const activityEmoji: Record<string, string> = {
	thinking: "🧠",
	reading: "📖",
	writing: "✍️",
	running: "⚡",
	searching: "🔍",
	working: "🔄",
};

function formatActivityStatus(activity: ActivityUpdate): string {
	const emoji = activityEmoji[activity.type] || "🔄";
	const detail = activity.detail ? `\n└─ ${activity.detail}` : "";
	return `${emoji} Working... (${activity.elapsed}s)${detail}`;
}

async function main() {
	logger.info("Mini-Claw starting...");

	const config = loadConfig();
	logger.info(`Workspace: ${config.workspace}`);
	logger.info(`Session dir: ${config.sessionDir}`);

	await mkdir(config.workspace, { recursive: true });
	await mkdir(config.sessionDir, { recursive: true });

	initializeDatabase(config.workspace);

	const piOk = await checkPiAuth();
	if (!piOk) {
		logger.error("Pi is not installed or not authenticated.");
		logger.error("Run 'pi /login' to authenticate with an AI provider.");
		process.exit(1);
	}
	logger.info("Pi: OK");

	const channel = createTelegramChannel(config);

	channel.onMessageSent(async (sessionId, platformMsgId, content, status) => {
		updateOrInsertAssistantMessage(sessionId, content, status, platformMsgId);
	});

	channel.onMessage(async (channelId, userId, platformMsgId, content) => {
		const session = ensureSession(userId);
		const sessionId = session.id;

		const userMsg = insertMessage({ sessionId, id: platformMsgId, role: "user", content });
		logger.info(`Saved user message ${userMsg.id} for session ${sessionId} (user ${userId})`);

		const ackMsgId = await channel.sendAckMessage(channelId, sessionId, "🔄 Working...");

		const workspace = await getWorkspace(channelId);
		let lastActivityUpdate = Date.now();

		try {
			const result = await runPiWithStreaming(
				config,
				channelId,
				sessionId,
				content,
				workspace,
				async (activity: ActivityUpdate) => {
					if (ackMsgId === undefined) return;
					const now = Date.now();
					if (now - lastActivityUpdate < 2000) return;
					lastActivityUpdate = now;
					try {
						await channel.updateOrSendMessage(
							channelId,
							sessionId,
							formatActivityStatus(activity),
							ackMsgId,
							"ACK",
						);
					} catch {
						logger.error("Failed to send activity progress update during streaming.");
					}
				},
			);

			const finalContent = result.error
				? `Error: ${result.error}`
				: result.output || "(no response)";

			await channel.updateOrSendMessage(channelId, sessionId, finalContent, ackMsgId, "processed");
			markMessageProcessed(userMsg.id, sessionId);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
			await channel.updateOrSendMessage(
				channelId,
				sessionId,
				`Failed to process: ${errorMsg}`,
				ackMsgId,
				"processed",
			);
		}
	});

	const shutdown = () => {
		logger.info("Shutting down...");
		channel.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	logger.info("Starting channel...");
	await channel.start();
}

main().catch((err) => {
	logger.fatal("Fatal error:", err);
	process.exit(1);
});
