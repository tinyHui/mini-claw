import type { Bot, Context } from "grammy";
import { toTelegramMarkdown } from "./telegram-format.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function splitTelegramMessage(text: string): string[] {
	if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
			chunks.push(remaining);
			break;
		}
		let splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
		if (splitIndex === -1 || splitIndex < TELEGRAM_MAX_MESSAGE_LENGTH / 2) {
			splitIndex = remaining.lastIndexOf(" ", TELEGRAM_MAX_MESSAGE_LENGTH);
		}
		if (splitIndex === -1 || splitIndex < TELEGRAM_MAX_MESSAGE_LENGTH / 2) {
			splitIndex = TELEGRAM_MAX_MESSAGE_LENGTH;
		}
		chunks.push(remaining.slice(0, splitIndex));
		remaining = remaining.slice(splitIndex).trimStart();
	}

	return chunks;
}

export async function sendTelegramText(
	api: Bot<Context>["api"],
	chatId: number,
	content: string,
): Promise<string> {
	const chunks = splitTelegramMessage(content);
	let firstMsgId: string | undefined;
	for (const chunk of chunks) {
		try {
			const mdv2 = toTelegramMarkdown(chunk);
			const msg = await api.sendMessage(chatId, mdv2, {
				parse_mode: "MarkdownV2",
			});
			firstMsgId ??= String(msg.message_id);
		} catch {
			const msg = await api.sendMessage(chatId, chunk);
			firstMsgId ??= String(msg.message_id);
		}
	}
	return firstMsgId!;
}
