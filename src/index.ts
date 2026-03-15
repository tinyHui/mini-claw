import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { createTelegramChannel } from "./channels/telegram.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { logger } from "./logger.js";
import {
	insertAckMessage,
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

	// After updateOrSendMessage delivers the final response, sync the DB:
	// - ack existed  → update that row's content and mark it processed
	// - no ack       → insert a new assistant message row
	channel.onMessageSent(async (sessionId, platformMsgId, content) => {
		updateOrInsertAssistantMessage(sessionId, content, platformMsgId);
	});

	// Callback-driven workflow:
	// channel receives message
	//   → ensureSession + save user message to DB
	//   → sendAckMessage → persist ack row if platformMsgId returned
	//   → runPi with streaming progress updates
	//   → updateOrSendMessage (edits ack in place or sends new message)
	//     → fires onMessageSent → DB update handled automatically
	//   → mark user message processed
	channel.onMessage(async (sessionId, content) => {
		ensureSession(sessionId);

		const userMsg = insertMessage({ sessionId, role: "user", content });
		logger.info(`Saved user message ${userMsg.id} for session ${sessionId}`);

		const platformMsgId = await channel.sendAckMessage(sessionId, "🔄 Working...");
		if (platformMsgId !== undefined) {
			insertAckMessage(platformMsgId, sessionId, "🔄 Working...");
		}

		const workspace = await getWorkspace(parseInt(sessionId, 10));
		let lastActivityUpdate = Date.now();

		try {
			const result = await runPiWithStreaming(
				config,
				parseInt(sessionId, 10),
				content,
				workspace,
				async (activity: ActivityUpdate) => {
					if (platformMsgId === undefined) return;
					const now = Date.now();
					if (now - lastActivityUpdate < 2000) return;
					lastActivityUpdate = now;
					// Progress-only edit — does not trigger onMessageSent
					try {
						await channel.updateOrSendMessage(
							sessionId,
							formatActivityStatus(activity),
							platformMsgId,
						);
					} catch {
						// Ignore progress update failures
					}
				},
			);

			const finalContent = result.error
				? `Error: ${result.error}`
				: result.output || "(no response)";

			// Delivers final response and fires onMessageSent → DB synced automatically
			await channel.updateOrSendMessage(sessionId, finalContent, platformMsgId);
			markMessageProcessed(userMsg.id, sessionId);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
			await channel.updateOrSendMessage(
				sessionId,
				`Failed to process: ${errorMsg}`,
				platformMsgId,
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
