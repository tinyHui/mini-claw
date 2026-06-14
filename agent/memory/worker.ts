import type { Config } from "../config.js";
import { logger } from "../logger.js";
import {
	getProcessedMessagesForReviewWindow,
	markMessagesReviewed,
} from "../message-repository.js";
import { ensureWorkspaceMemoryFiles } from "../pi-utils.js";
import { reviewMemoryBatch } from "./reviewer.js";

export interface MemoryReviewRunResult {
	status: "disabled" | "already_running" | "no_messages" | "completed" | "failed";
	reviewedMessages: number;
	accepted: number;
	staged: number;
	rejected: number;
	error?: string;
}

export type MemoryReviewProgressCallback = (message: string) => void | Promise<void>;

export interface MemoryReviewWindow {
	start: Date;
	end: Date;
}

export interface RunMemoryReviewOptions {
	onProgress?: MemoryReviewProgressCallback;
	now?: Date;
	window?: MemoryReviewWindow;
}

export interface MemoryReviewWorker {
	runOnce(onProgress?: MemoryReviewProgressCallback): Promise<MemoryReviewRunResult>;
	stop(): void;
	getLastReviewAt(): string | undefined;
}

let running = false;

async function emit(onProgress: MemoryReviewProgressCallback | undefined, message: string): Promise<void> {
	await onProgress?.(message);
}

export function getMemoryReviewWindow(now = new Date()): MemoryReviewWindow {
	const start = new Date(now);
	start.setHours(3, 0, 0, 0);
	if (start >= now) {
		start.setDate(start.getDate() - 1);
	}
	return { start, end: now };
}

export async function runMemoryReviewOnce(
	config: Config,
	options: RunMemoryReviewOptions = {},
): Promise<MemoryReviewRunResult> {
	const onProgress = options.onProgress;
	if (!config.memoryReviewEnabled) {
		await emit(onProgress, "Memory review is disabled.");
		return { status: "disabled", reviewedMessages: 0, accepted: 0, staged: 0, rejected: 0 };
	}
	if (running) {
		await emit(onProgress, "A memory review is already running.");
		return { status: "already_running", reviewedMessages: 0, accepted: 0, staged: 0, rejected: 0 };
	}
	running = true;
	try {
		await emit(onProgress, "Preparing workspace memory files.");
		await ensureWorkspaceMemoryFiles(config.workspace);
		await emit(onProgress, "Loading processed chat messages.");
		const window = options.window ?? getMemoryReviewWindow(options.now);
		const messages = getProcessedMessagesForReviewWindow({
			...window,
			limit: config.memoryReviewBatchLimit,
		});
		if (messages.length === 0) {
			await emit(onProgress, "No processed messages need review.");
			return { status: "no_messages", reviewedMessages: 0, accepted: 0, staged: 0, rejected: 0 };
		}
		await emit(onProgress, `Reviewing ${messages.length} processed message${messages.length === 1 ? "" : "s"}.`);
		const summary = await reviewMemoryBatch({ config, messages });
		await emit(onProgress, "Marking reviewed messages.");
		markMessagesReviewed(messages);
		return {
			status: "completed",
			reviewedMessages: messages.length,
			...summary,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn("Memory review failed", {
			error: message,
		});
		await emit(onProgress, `Memory review failed: ${message}`);
		return { status: "failed", reviewedMessages: 0, accepted: 0, staged: 0, rejected: 0, error: message };
	} finally {
		running = false;
	}
}

export function createMemoryReviewWorker(config: Config): MemoryReviewWorker {
	let lastReviewAt: string | undefined;

	return {
		async runOnce(onProgress?: MemoryReviewProgressCallback) {
			const result = await runMemoryReviewOnce(config, { onProgress });
			if (result.status === "completed") {
				lastReviewAt = new Date().toISOString();
			}
			return result;
		},
		stop() {
			// Scheduling is handled by cron; the command-facing worker has no timer to stop.
		},
		getLastReviewAt() {
			return lastReviewAt;
		},
	};
}
