import { mkdir } from "node:fs/promises";
import { createTelegramChannel } from "./channels/telegram.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { ensureSandboxInitialized, resetSandbox } from "./extensions/sandbox/index.js";
import { createCommandProcessor } from "./handler/command-processor.js";
import { createTelegramHandlerDispatcher } from "./handler/dispatcher.js";
import { createMessageProcessor } from "./handler/message-processor.js";
import { processTelegramUpdate } from "./handler/pipeline.js";
import { createUnsupportedProcessor } from "./handler/unsupported-processor.js";
import { initializeLogger, logger, withLogContext } from "./logger.js";
import {
	updateOrInsertAssistantMessage,
} from "./message-repository.js";
import { createMemoryReviewWorker } from "./memory/worker.js";
import { checkPiAuth } from "./pi-runner.js";
import { ensureSoulPromptFile, ensureWorkspaceMemoryFiles } from "./pi-utils.js";

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
		await ensureWorkspaceMemoryFiles(config.workspace);
		logger.info("Workspace prompt and memory files ready, booting Pi...");

		initializeDatabase();

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

		const memoryWorker = createMemoryReviewWorker(config);
		const channel = createTelegramChannel(config);
		const dispatcher = createTelegramHandlerDispatcher([
			createMessageProcessor(),
			createCommandProcessor(),
			createUnsupportedProcessor(),
		]);

		channel.onMessageSent(async (sessionId, telegramMessageId, content, status) => {
			await withLogContext(
				{
					sessionId,
					telegramMessageId,
					operation: "message_sent",
				},
				async () => {
					updateOrInsertAssistantMessage(sessionId, content, status, telegramMessageId);
					logger.debug("Assistant delivery synced to message repository");
				},
			);
		});

		channel.onIncoming(async (update) => {
			await processTelegramUpdate(update, {
				config,
				channel,
				dispatcher,
				memoryWorker,
			});
		});

		const shutdown = () => {
			void withLogContext({ operation: "shutdown" }, async () => {
				logger.info("Shutting down...");
				channel.stop();
				memoryWorker.stop();
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
