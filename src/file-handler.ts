import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { Context } from "grammy";
import type { Message } from "@grammyjs/types";

export interface DownloadedFile {
	localPath: string;
}

export function hasAttachment(message: Message): boolean {
	return !!message.photo || !!message.document;
}

function extractFileInfo(message: Message): { fileId: string; ext: string } {
	if (message.photo) {
		const largest = message.photo[message.photo.length - 1];
		return { fileId: largest.file_id, ext: ".jpg" };
	}
	if (message.document) {
		const ext = message.document.file_name
			? extname(message.document.file_name) || ".bin"
			: ".bin";
		return { fileId: message.document.file_id, ext };
	}
	throw new Error("Message has no downloadable attachment");
}

export async function downloadAttachment(
	ctx: Context,
): Promise<DownloadedFile> {
	const message = ctx.message;
	if (!message) throw new Error("No message in context");

	const { fileId, ext } = extractFileInfo(message);
	const targetPath = join(tmpdir(), `mini-claw-${randomUUID()}${ext}`);

	const file = await ctx.api.getFile(fileId);
	// download() is added by @grammyjs/files hydrateFiles transformer
	const localPath = await (file as unknown as { download: (p: string) => Promise<string> }).download(targetPath);

	return { localPath };
}

export async function cleanupFile(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch {
		// Best-effort cleanup
	}
}
