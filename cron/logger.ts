import {
	ConsoleAppender,
	FileAppender,
	LogLevel,
	logManager,
} from "perfect-logger";

const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

const CONSOLE_FORMAT =
	`${GREEN}{time}${RESET} [${BLUE}{level}${RESET}] ${MAGENTA}{namespace}${RESET}: {message} ${GRAY}{context}${RESET}{error}`;
const FILE_FORMAT = "{date} {time} [{level}] {namespace}: {message} {context}{error}";

function parseLogLevel(level: string | undefined): LogLevel {
	switch (level?.trim().toUpperCase()) {
		case "TRACE": return LogLevel.TRACE;
		case "DEBUG": return LogLevel.DEBUG;
		case "WARN": return LogLevel.WARN;
		case "ERROR": return LogLevel.ERROR;
		case "FATAL": return LogLevel.FATAL;
		default: return LogLevel.INFO;
	}
}

export function initializeLogger(logLevel: string | undefined, workspace: string): void {
	const level = parseLogLevel(logLevel);
	logManager.configure({
		minLevel: level,
		appenders: [
			new ConsoleAppender({ minLevel: level, format: CONSOLE_FORMAT }),
			new FileAppender({
				minLevel: level,
				logDirectory: workspace,
				fileName: "mini-claw.log",
				format: FILE_FORMAT,
				rotation: "daily",
				maxSize: 10 * 1024 * 1024,
				maxFiles: 7,
			}),
		],
	});
}

const baseLogger = logManager.getLogger("mini-claw-cron");

export const logger = {
	info(message: string, context?: Record<string, unknown>) {
		baseLogger.info(message, context);
	},
	warn(message: string, context?: Record<string, unknown>) {
		baseLogger.warn(message, context);
	},
	error(message: string, error?: unknown, context?: Record<string, unknown>) {
		baseLogger.error(message, error instanceof Error ? error : undefined, context);
	},
};
