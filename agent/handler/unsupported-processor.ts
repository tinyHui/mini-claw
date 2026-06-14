import type {
	IncomingTelegramUpdate,
	ProcessorContext,
	ProcessorResult,
	TelegramProcessor,
} from "./types.js";

export class UnsupportedProcessor implements TelegramProcessor {
	canHandle(update: IncomingTelegramUpdate): boolean {
		return update.kind === "unsupported";
	}

	async process(
		update: IncomingTelegramUpdate,
		_context: ProcessorContext,
	): Promise<ProcessorResult> {
		if (update.kind !== "unsupported") {
			throw new Error("UnsupportedProcessor received a supported update");
		}
		return { content: "This message type is not supported yet." };
	}
}

export function createUnsupportedProcessor(): UnsupportedProcessor {
	return new UnsupportedProcessor();
}
