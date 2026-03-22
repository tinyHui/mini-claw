import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function getSoulPromptPath(workspace: string): string {
	return join(workspace, "SOUL.md");
}

export async function ensureSoulPromptFile(workspace: string): Promise<void> {
	const soulPath = getSoulPromptPath(workspace);

	try {
		await access(soulPath);
	} catch {
		await writeFile(soulPath, "", { flag: "wx" }).catch(() => {});
	}

	try {
		await access(soulPath);
	} catch {
		throw new Error(`Missing required system prompt file: ${soulPath}`);
	}
}

export async function readSoulPromptFile(workspace: string): Promise<string> {
	const soulPath = getSoulPromptPath(workspace);
	return readFile(soulPath, "utf-8");
}
