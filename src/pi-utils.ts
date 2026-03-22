import { access, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

export function getSoulPromptPath(workspace: string): string {
	return join(workspace, "SOUL.md");
}

export async function ensureSoulPromptFile(workspace: string): Promise<void> {
	const soulPath = getSoulPromptPath(workspace);

	// Try to ensure the file exists
	try {
		await access(soulPath);
	} catch {
		// If missing, create as empty file
		await writeFile(soulPath, "", { flag: "wx" }).catch(() => {});
	}

	// Check again (it should exist at this point), and verify it's non-empty
	let fileStat;
	try {
		fileStat = await stat(soulPath);
	} catch {
		throw new Error(`Missing required system prompt file: ${soulPath}`);
	}

	if (!fileStat.isFile() || fileStat.size === 0) {
		throw new Error(
			`System prompt file ${soulPath} is required and must not be empty. ` +
			"Please provide a system prompt for the workspace."
		);
	}
}

export async function readSoulPromptFile(workspace: string): Promise<string> {
	const soulPath = getSoulPromptPath(workspace);
	return readFile(soulPath, "utf-8");
}
