import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { checkPiAuth } from "./pi-runner.js";

async function main() {
	logger.info("Mini-Claw starting...");

	// Load configuration
	const config = loadConfig();
	logger.info(`Workspace: ${config.workspace}`);
	logger.info(`Session dir: ${config.sessionDir}`);

	// Ensure directories exist
	await mkdir(config.workspace, { recursive: true });
	await mkdir(config.sessionDir, { recursive: true });

	// Check Pi installation (fatal if not available)
	const piOk = await checkPiAuth();
	if (!piOk) {
		logger.error("Error: Pi is not installed or not authenticated.");
		logger.error("Run 'pi /login' to authenticate with an AI provider.");
		process.exit(1);
	}
	logger.info("Pi: OK");

	// Create and start bot
	const bot = createBot(config);

	// Graceful shutdown
	const shutdown = () => {
		logger.info("Shutting down...");
		bot.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	logger.info("Bot starting...");
	await bot.start({
		onStart: (botInfo) => {
			logger.info(`Bot @${botInfo.username} is running!`);
		},
	});
}

main().catch((err) => {
	logger.fatal("Fatal error:", err);
	process.exit(1);
});
