import { homedir } from "node:os";
import { join } from "node:path";
import {
	ConsoleAppender,
	FileAppender,
	LogLevel,
	logManager,
} from "perfect-logger";

function parseLogLevel(level: string | undefined): LogLevel {
	switch (level?.toUpperCase()) {
		case "TRACE":
			return LogLevel.TRACE;
		case "DEBUG":
			return LogLevel.DEBUG;
		case "WARN":
			return LogLevel.WARN;
		case "ERROR":
			return LogLevel.ERROR;
		case "FATAL":
			return LogLevel.FATAL;
		default:
			return LogLevel.INFO;
	}
}

const minLevel = parseLogLevel(process.env.LOG_LEVEL);

const workspace =
	process.env.MINI_CLAW_WORKSPACE?.trim() ||
	join(homedir(), "mini-claw-workspace");

logManager.configure({
	appenders: [
		new ConsoleAppender({ minLevel }),
		new FileAppender({
			logDirectory: workspace,
			fileName: "mini-claw.log",
			minLevel,
			rotation: "daily",
			maxSize: 10 * 1024 * 1024,
			maxFiles: 7,
		}),
	],
});

export const logger = logManager.getLogger("mini-claw");
