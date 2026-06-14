import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { getProcessedMessagesForReview, markMessagesReviewed } from "../message-repository.js";
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

export interface MemoryReviewWorker {
	runOnce(onProgress?: MemoryReviewProgressCallback): Promise<MemoryReviewRunResult>;
	stop(): void;
	getLastReviewAt(): string | undefined;
}

export function createMemoryReviewWorker(config: Config): MemoryReviewWorker {
	let running = false;
	let lastReviewAt: string | undefined;
	let timer: NodeJS.Timeout | undefined;

	async function emit(onProgress: MemoryReviewProgressCallback | undefined, message: string): Promise<void> {
		await onProgress?.(message);
	}

	async function runOnce(onProgress?: MemoryReviewProgressCallback): Promise<MemoryReviewRunResult> {
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
			const messages = getProcessedMessagesForReview(config.memoryReviewBatchLimit);
			if (messages.length === 0) {
				await emit(onProgress, "No processed messages need review.");
				return { status: "no_messages", reviewedMessages: 0, accepted: 0, staged: 0, rejected: 0 };
			}
			await emit(onProgress, `Reviewing ${messages.length} processed message${messages.length === 1 ? "" : "s"}.`);
			const summary = await reviewMemoryBatch({ config, messages });
			await emit(onProgress, "Marking reviewed messages.");
			markMessagesReviewed(messages);
			lastReviewAt = new Date().toISOString();
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

	if (config.memoryReviewEnabled) {
		timer = setInterval(() => {
			void runOnce();
		}, config.memoryReviewIntervalMs);
		timer.unref?.();
	}

	return {
		runOnce,
		stop() {
			if (timer) clearInterval(timer);
		},
		getLastReviewAt() {
			return lastReviewAt;
		},
	};
}
