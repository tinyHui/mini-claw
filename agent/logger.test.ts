import { LogLevel } from "perfect-logger";
import { describe, expect, it } from "vitest";
import {
	getLogContext,
	initializeLogger,
	parseLogLevel,
	withLogContext,
} from "./logger.js";

describe("withLogContext", () => {
	it("merges nested context values", () => {
		withLogContext({ channelId: "ch-1", userId: "u-1" }, () => {
			withLogContext({ sessionId: "s-1" }, () => {
				expect(getLogContext()).toMatchObject({
					channelId: "ch-1",
					userId: "u-1",
					sessionId: "s-1",
				});
			});
		});
	});

	it("overrides values and removes undefined keys", () => {
		withLogContext({ sessionId: "s-1", operation: "incoming" }, () => {
			withLogContext({ sessionId: "s-2", operation: undefined }, () => {
				expect(getLogContext()).toMatchObject({
					sessionId: "s-2",
				});
				expect(getLogContext().operation).toBeUndefined();
			});
		});
	});

	it("propagates context across async boundaries", async () => {
		await withLogContext({ sessionId: "s-1", channelId: "ch-1" }, async () => {
			await Promise.resolve();
			expect(getLogContext()).toMatchObject({
				sessionId: "s-1",
				channelId: "ch-1",
			});
		});
	});
});

describe("parseLogLevel", () => {
	it("parses trimmed values", () => {
		expect(parseLogLevel("  debug  ")).toBe(LogLevel.DEBUG);
		expect(parseLogLevel("INFO")).toBe(LogLevel.INFO);
	});

	it("defaults to INFO for unknown values", () => {
		expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
		expect(parseLogLevel("")).toBe(LogLevel.INFO);
		expect(parseLogLevel("  ")).toBe(LogLevel.INFO);
	});

	it("recognizes all levels", () => {
		expect(parseLogLevel("trace")).toBe(LogLevel.TRACE);
		expect(parseLogLevel("DEBUG")).toBe(LogLevel.DEBUG);
		expect(parseLogLevel("warn")).toBe(LogLevel.WARN);
		expect(parseLogLevel("ERROR")).toBe(LogLevel.ERROR);
		expect(parseLogLevel("fatal")).toBe(LogLevel.FATAL);
	});
});

describe("initializeLogger", () => {
	it("does not throw when called with valid arguments", () => {
		expect(() => initializeLogger("debug", "/tmp/test-logs")).not.toThrow();
	});

	it("accepts all recognized log level strings", () => {
		for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
			expect(() => initializeLogger(level, "/tmp/test-logs")).not.toThrow();
		}
	});
});
