import {
	errorStack,
	startMailboxTelegramDispatcher,
} from "./telegram-cron-output-dispatcher.js";

const runtime = await startMailboxTelegramDispatcher().catch((error: unknown) => {
	console.error("Failed to start telegram cron output mailman");
	console.error(errorStack(error));
	process.exit(1);
});

const shutdown = () => {
	runtime.dispatcher.stop();
	runtime.sqlite.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
