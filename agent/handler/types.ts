import type { Config } from "../config.js";
import type { MemoryReviewWorker } from "../memory/worker.js";
import type { ActivityUpdate } from "../pi-runner.js";

export type IncomingTelegramUpdate =
	| {
		kind: "message";
		chatId: string;
		telegramMessageId: string;
		text: string;
	}
	| {
		kind: "command";
		chatId: string;
		telegramMessageId: string;
		text: string;
		command: string;
		args: string[];
	}
	| {
		kind: "unsupported";
		chatId: string;
		telegramMessageId: string;
		messageType: string;
	};

export interface ProcessorResult {
	content: string;
}

export type ProgressStepType =
	| "planning"
	| "thinking"
	| "tool"
	| "shell"
	| "coding"
	| "skill"
	| "review"
	| "memory"
	| "command"
	| "message"
	| "working";

export interface ProgressStep {
	type: ProgressStepType;
	description: string;
	key?: string;
}

export interface ProgressReporter {
	step(step: ProgressStep): Promise<void>;
	activity(activity: ActivityUpdate): Promise<void>;
}

export interface ProcessorContext {
	config: Config;
	sessionId: string;
	progress: ProgressReporter;
	memoryWorker?: MemoryReviewWorker;
}

export interface TelegramProcessor {
	canHandle(update: IncomingTelegramUpdate): boolean;
	process(
		update: IncomingTelegramUpdate,
		context: ProcessorContext,
	): Promise<ProcessorResult>;
}

export interface TelegramDeliveryPort {
	sendAckMessage(
		chatId: string,
		sessionId: string,
		content: string,
		syncDelivery?: boolean,
	): Promise<string | undefined>;
	updateOrSendMessage(
		chatId: string,
		sessionId: string,
		content: string,
		telegramMessageId?: string,
		status?: "ACK" | "processed",
		syncDelivery?: boolean,
	): Promise<void>;
}
