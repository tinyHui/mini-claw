import { mkdir } from "node:fs/promises";
import { createTelegramChannel } from "./channels/telegram.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { ensureSandboxInitialized, resetSandbox } from "./extensions/sandbox/index.js";
import { initializeLogger, logger, withLogContext } from "./logger.js";
import {
	insertMessage,
	markMessageProcessed,
	updateOrInsertAssistantMessage,
} from "./message-repository.js";
import { type ActivityUpdate, checkPiAuth, runPiWithStreaming } from "./pi-runner.js";
import { ensureSoulPromptFile, getSoulPromptPath } from "./pi-utils.js";
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
	if (activity.elapsed === 0) {
		return `${emoji} Working...`;
	}
	return `${emoji} Working...${detail} (${activity.elapsed}s)`;
}

async function main() {
	return withLogContext({ operation: "startup" }, async () => {
		const config = loadConfig();
		initializeLogger(config.logLevel, config.workspace);
		logger.info("Mini-Claw starting...");
		logger.debug(`Workspace: ${config.workspace}`);
		logger.debug(`Session dir: ${config.sessionDir}`);

		await mkdir(config.workspace, { recursive: true });
		await mkdir(config.sessionDir, { recursive: true });
		await ensureSoulPromptFile(config.workspace);
		logger.info("SOUL.md file found, booting Pi...");

		initializeDatabase(config.workspace);

		const piOk = await checkPiAuth();
		if (!piOk) {
			logger.error("Pi SDK has no authenticated model available.");
			logger.error("Run 'make login' to authenticate with an AI provider.");
			process.exit(1);
		}
		logger.info("Pi: OK");

		const sandboxOk = await ensureSandboxInitialized();
		if (sandboxOk) {
			logger.info("Sandbox: OK");
		} else {
			logger.info("Sandbox: disabled (unsupported platform or init failed)");
		}

		const channel = createTelegramChannel(config);

	channel.onMessageSent(async (sessionId, platformMsgId, content, status) => {
		await withLogContext(
			{
				sessionId,
				platformMsgId,
				operation: "message_sent",
			},
			async () => {
				updateOrInsertAssistantMessage(sessionId, content, status, platformMsgId);
				logger.debug("Assistant delivery synced to message repository");
			},
		);
	});

	channel.onMessage(async (channelId, userId, platformMsgId, content) => {
		await withLogContext(
			{
				channelId,
				userId,
				platformMsgId,
				operation: "incoming_message",
			},
			async () => {
				const session = ensureSession(userId);
				const sessionId = session.id;
				await withLogContext({ sessionId }, async () => {
					const userMsg = insertMessage({ sessionId, id: platformMsgId, role: "user", content });
					logger.debug(`Saved user message ${userMsg.id}`);

					const startTime = Date.now();
					const ackMsgId = await channel.sendAckMessage(
						channelId,
						sessionId,
						formatActivityStatus({ type: "working", detail: "", elapsed: 0 }),
					);

					const workspace = await getWorkspace(channelId);
					let lastActivityUpdate = Date.now();
					let lastActivity: ActivityUpdate = { type: "working", detail: "", elapsed: 0 };
					const ackInterval = setInterval(async () => {
						if (ackMsgId === undefined) return;
						const elapsed = Math.floor((Date.now() - startTime) / 1000);
						const tick: ActivityUpdate = {
							...lastActivity,
							elapsed,
						};
						try {
							await channel.updateOrSendMessage(
								channelId,
								sessionId,
								formatActivityStatus(tick),
								ackMsgId,
								"ACK",
							);
						} catch {
							// best effort tick updates
						}
					}, 5000);

					try {
						const result = await runPiWithStreaming(
							config,
							channelId,
							userId,
							sessionId,
							content,
							workspace,
							async (activity: ActivityUpdate) => {
								if (ackMsgId === undefined) return;
								lastActivity = activity;
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
						clearInterval(ackInterval);

						const finalContent = result.error
							? `Error: ${result.error}`
							: result.output || "(no response)";

						await channel.updateOrSendMessage(
							channelId,
							sessionId,
							finalContent,
							ackMsgId,
							"processed",
						);
						markMessageProcessed(userMsg.id, sessionId);
					} catch (err) {
						clearInterval(ackInterval);
						const errorMsg = err instanceof Error ? err.message : "Unknown error";
						await channel.updateOrSendMessage(
							channelId,
							sessionId,
							`Failed to process: ${errorMsg}`,
							ackMsgId,
							"processed",
						);
						logger.error("Failed to process incoming message", err);
					}
				});
			},
		);
	});

		const shutdown = () => {
			void withLogContext({ operation: "shutdown" }, async () => {
				logger.info("Shutting down...");
				channel.stop();
				await resetSandbox();
				process.exit(0);
			});
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		logger.info("Starting channel...");
		await channel.start();
	});
}

main().catch((err) => {
	void withLogContext({ operation: "startup" }, () => {
		logger.fatal("Fatal error:", err);
		process.exit(1);
	});
});
