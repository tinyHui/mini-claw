import { runPiWithStreaming } from "../pi-runner.js";
import { getWorkspace } from "../workspace.js";
import type {
	IncomingTelegramUpdate,
	ProcessorContext,
	ProcessorResult,
	TelegramProcessor,
} from "./types.js";

export class MessageProcessor implements TelegramProcessor {
	canHandle(update: IncomingTelegramUpdate): boolean {
		return update.kind === "message";
	}

	async process(
		update: IncomingTelegramUpdate,
		context: ProcessorContext,
	): Promise<ProcessorResult> {
		if (update.kind !== "message") {
			throw new Error("MessageProcessor received a non-message update");
		}

		const workspace = await getWorkspace(update.chatId);
		await context.progress.step({
			type: "planning",
			description: "Planning",
			key: "pi:planning",
		});
		const result = await runPiWithStreaming(
			context.config,
			context.sessionId,
			update.text,
			workspace,
			(activity) => {
				void context.progress.activity(activity);
			},
		);

		return {
			content: result.error
				? `Error: ${result.error}`
				: result.output || "(no response)",
		};
	}
}

export function createMessageProcessor(): MessageProcessor {
	return new MessageProcessor();
}
