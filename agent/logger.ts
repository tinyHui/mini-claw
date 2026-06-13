import { AsyncLocalStorage } from "node:async_hooks";
import {
	ConsoleAppender,
	FileAppender,
	LogLevel,
	logManager,
} from "perfect-logger";

type LogContextValue = string | number | boolean;
export type LogContext = Record<string, LogContextValue | undefined>;

const logContextStorage = new AsyncLocalStorage<LogContext>();

const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

const CONSOLE_FORMAT =
	`${GREEN}{time}${RESET} [${BLUE}{level}${RESET}] ${MAGENTA}{namespace}${RESET}: {message} ${GRAY}{context}${RESET}{error}`;
const FILE_FORMAT = "{date} {time} [{level}] {namespace}: {message} {context}{error}";

export function parseLogLevel(level: string | undefined): LogLevel {
	switch (level?.trim().toUpperCase()) {
		case "TRACE": return LogLevel.TRACE;
		case "DEBUG": return LogLevel.DEBUG;
		case "WARN": return LogLevel.WARN;
		case "ERROR": return LogLevel.ERROR;
		case "FATAL": return LogLevel.FATAL;
		default: return LogLevel.INFO;
	}
}

export function getLogContext(): LogContext {
	return logContextStorage.getStore() ?? {};
}

export function withLogContext<T>(context: LogContext, run: () => T): T {
	const merged: LogContext = { ...getLogContext(), ...context };
	for (const key of Object.keys(merged)) {
		if (merged[key] === undefined) delete merged[key];
	}
	return logContextStorage.run(merged, run);
}

export function initializeLogger(logLevel: string, workspace: string): void {
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

const baseLogger = logManager.getLogger("mini-claw");

function mergedContext(extra?: LogContext): Record<string, LogContextValue> | undefined {
	const als = getLogContext();
	const combined = { ...als, ...extra };
	const cleaned: Record<string, LogContextValue> = {};
	for (const [k, v] of Object.entries(combined)) {
		if (v !== undefined) cleaned[k] = v;
	}
	return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function wrapStandard(method: (msg: string, ctx?: Record<string, unknown>) => void) {
	return (message: string, context?: LogContext) => {
		method(message, mergedContext(context));
	};
}

function wrapError(method: (msg: string, err?: Error, ctx?: Record<string, unknown>) => void) {
	return (message: string, error?: unknown, context?: LogContext) => {
		const err = error instanceof Error ? error : error != null ? new Error(String(error)) : undefined;
		method(message, err, mergedContext(context));
	};
}

export const logger = {
	trace: wrapStandard(baseLogger.trace.bind(baseLogger)),
	debug: wrapStandard(baseLogger.debug.bind(baseLogger)),
	info: wrapStandard(baseLogger.info.bind(baseLogger)),
	warn: wrapStandard(baseLogger.warn.bind(baseLogger)),
	error: wrapError(baseLogger.error.bind(baseLogger)),
	fatal: wrapError(baseLogger.fatal.bind(baseLogger)),
};
