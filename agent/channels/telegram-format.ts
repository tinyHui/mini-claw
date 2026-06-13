import telegramifyMarkdown from "telegramify-markdown";

export function toTelegramMarkdown(text: string): string {
	return telegramifyMarkdown(text, "escape");
}
