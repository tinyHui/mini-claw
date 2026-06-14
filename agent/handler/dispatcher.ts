import type { IncomingTelegramUpdate, TelegramProcessor } from "./types.js";

export class TelegramHandlerDispatcher {
	constructor(private readonly processors: TelegramProcessor[]) {}

	resolve(update: IncomingTelegramUpdate): TelegramProcessor {
		const processor = this.processors.find((candidate) => candidate.canHandle(update));
		if (!processor) {
			throw new Error(`No processor registered for ${update.kind}`);
		}
		return processor;
	}
}

export function createTelegramHandlerDispatcher(
	processors: TelegramProcessor[],
): TelegramHandlerDispatcher {
	return new TelegramHandlerDispatcher(processors);
}
